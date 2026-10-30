import { buildChanges } from "./changes.js";

const SDK = window.NutrientViewer;
const LICENSE_KEY = window.APP_CONFIG?.licenseKey || undefined;

const SAMPLES = [
  {
    id: "contract",
    label: "Sample: service agreement v1 / v2",
    mode: "text",
    original: { name: "service-agreement-v1.pdf", url: "/samples/service-agreement-v1.pdf" },
    changed: { name: "service-agreement-v2.pdf", url: "/samples/service-agreement-v2.pdf" },
  },
  {
    id: "plan",
    label: "Sample: floor plan rev A / rev B",
    mode: "visual",
    original: { name: "floor-plan-rev-a.pdf", url: "/samples/floor-plan-rev-a.pdf" },
    changed: { name: "floor-plan-rev-b.pdf", url: "/samples/floor-plan-rev-b.pdf" },
  },
];

const COLORS = {
  deleted: new SDK.Color({ r: 217, g: 63, b: 63 }),
  inserted: new SDK.Color({ r: 46, g: 154, b: 91 }),
  moved: new SDK.Color({ r: 62, g: 99, b: 221 }),
  focus: new SDK.Color({ r: 47, g: 91, b: 211 }),
};

const TYPE_LABELS = { replaced: "Replaced", inserted: "Inserted", deleted: "Deleted", moved: "Moved" };

const state = {
  mode: "text",
  pair: SAMPLES[0],
  viewers: { original: null, changed: null, visual: null },
  changes: [],
  hidden: new Set(),
  selectedId: null,
  focusAnnotations: { original: [], changed: [] },
};

// Exposed for the detection check (tools/verify-detection.mjs) and for debugging.
window.comparison = { state: "loading" };

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Documents

async function loadSource(doc) {
  if (doc.file) return doc.file.arrayBuffer();
  const response = await fetch(doc.url);
  if (!response.ok) throw new Error(`Cannot load ${doc.name}`);
  return response.arrayBuffer();
}

function viewerConfiguration(container, document) {
  return {
    container,
    document,
    licenseKey: LICENSE_KEY,
    useCDN: true,
    toolbarItems: SDK.defaultToolbarItems.filter((item) =>
      ["pager", "zoom-out", "zoom-in", "zoom-mode", "search"].includes(item.type),
    ),
    // The change highlights are added by the app; users cannot edit them.
    isEditableAnnotation: () => false,
    initialViewState: new SDK.ViewState({ sidebarMode: null, zoom: SDK.ZoomMode.FIT_TO_WIDTH }),
  };
}

async function unloadAll() {
  for (const key of Object.keys(state.viewers)) {
    if (state.viewers[key]) {
      SDK.unload(state.viewers[key]);
      state.viewers[key] = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Text comparison

async function runTextComparison() {
  window.comparison = { state: "loading" };
  $("summary").textContent = "Loading the documents…";
  $("change-list").replaceChildren();
  $("filters").replaceChildren();
  $("name-original").textContent = state.pair.original.name;
  $("name-changed").textContent = state.pair.changed.name;

  const [originalData, changedData] = await Promise.all([loadSource(state.pair.original), loadSource(state.pair.changed)]);
  const [original, changed] = await Promise.all([
    SDK.load(viewerConfiguration("#viewer-original", originalData.slice(0))),
    SDK.load(viewerConfiguration("#viewer-changed", changedData.slice(0))),
  ]);
  state.viewers.original = original;
  state.viewers.changed = changed;

  $("summary").textContent = "Comparing the text…";
  const started = performance.now();
  const operation = new SDK.ComparisonOperation(SDK.ComparisonOperationType.TEXT, { numberOfContextWords: 3 });
  const result = await original.compareDocuments(
    {
      originalDocument: new SDK.DocumentDescriptor({ filePath: originalData.slice(0), pageIndexes: [[0, original.totalPageCount - 1]] }),
      changedDocument: new SDK.DocumentDescriptor({ filePath: changedData.slice(0), pageIndexes: [[0, changed.totalPageCount - 1]] }),
    },
    operation,
  );
  const elapsed = Math.round(performance.now() - started);
  const { changes, summary, ignoredWhitespaceChanges } = buildChanges(result);
  state.changes = changes;
  state.selectedId = null;

  await addHighlights(original, changed, changes);
  renderSummary(summary, elapsed);
  renderList();
  // A click on a highlighted passage selects its change in the list.
  [
    ["original", original],
    ["changed", changed],
  ].forEach(([sideName, instance]) => {
    let last = { id: null, time: 0 };
    const onPress = (event) => {
      const id = changeAt(sideName, event.pageIndex ?? event.annotation?.pageIndex, event.point) ?? event.annotation?.customData?.changeId;
      // One click can raise both events: handle it once.
      if (!id || (id === last.id && performance.now() - last.time < 400)) return;
      last = { id, time: performance.now() };
      selectChange(id, { scrollList: true });
    };
    instance.addEventListener("page.press", onPress);
    instance.addEventListener("annotations.press", onPress);
  });

  window.comparison = {
    state: "done",
    elapsedMs: elapsed,
    pages: { original: original.totalPageCount, changed: changed.totalPageCount },
    summary,
    ignoredWhitespaceChanges,
    changes,
    raw: result,
  };
}

function rect([left, top, width, height]) {
  return new SDK.Geometry.Rect({ left, top, width, height });
}

function union(rects) {
  const left = Math.min(...rects.map((r) => r[0]));
  const top = Math.min(...rects.map((r) => r[1]));
  const right = Math.max(...rects.map((r) => r[0] + r[2]));
  const bottom = Math.max(...rects.map((r) => r[1] + r[3]));
  return [left, top, right - left, bottom - top];
}

/** Highlights each change: red in the original, green in the changed version, blue for moves. */
async function addHighlights(original, changed, changes) {
  const annotations = { original: [], changed: [] };
  for (const change of changes) {
    for (const sideName of ["original", "changed"]) {
      const side = change[sideName];
      if (side.pageIndex == null) continue;
      const color = change.type === "moved" ? COLORS.moved : sideName === "original" ? COLORS.deleted : COLORS.inserted;
      const customData = { changeId: change.id };
      if (side.rects.length) {
        annotations[sideName].push(
          new SDK.Annotations.HighlightAnnotation({
            pageIndex: side.pageIndex,
            rects: SDK.Immutable.List(side.rects.map(rect)),
            boundingBox: rect(union(side.rects)),
            color,
            opacity: 0.45,
            customData,
          }),
        );
      } else if (side.marker) {
        // The text only exists on the other side: a thin caret shows where it was or will be.
        const [left, top] = side.marker;
        const markerColor = sideName === "original" ? COLORS.inserted : COLORS.deleted;
        annotations[sideName].push(
          new SDK.Annotations.RectangleAnnotation({
            pageIndex: side.pageIndex,
            boundingBox: new SDK.Geometry.Rect({ left: left - 1.5, top: top - 12, width: 3, height: 12 }),
            fillColor: markerColor,
            strokeColor: markerColor,
            strokeWidth: 0,
            customData,
          }),
        );
      }
    }
  }
  if (annotations.original.length) await original.create(annotations.original);
  if (annotations.changed.length) await changed.create(annotations.changed);
}

function renderSummary(summary, elapsed) {
  const parts = ["replaced", "inserted", "deleted", "moved"].map((type) => `${summary[type]} ${type}`);
  const time = elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s`;
  $("summary").textContent = `${summary.total} changes: ${parts.join(", ")}. Text compared in ${time}.`;
  const filters = $("filters");
  filters.replaceChildren(
    ...["replaced", "inserted", "deleted", "moved"].map((type) => {
      const button = document.createElement("button");
      button.className = `filter${state.hidden.has(type) ? " off" : ""}`;
      button.innerHTML = `<span class="badge ${type}">${TYPE_LABELS[type]}</span> ${summary[type]}`;
      button.addEventListener("click", () => {
        state.hidden.has(type) ? state.hidden.delete(type) : state.hidden.add(type);
        button.classList.toggle("off");
        renderList();
      });
      return button;
    }),
  );
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function pageLabel(change) {
  const o = change.original.pageIndex;
  const c = change.changed.pageIndex;
  if (change.type === "moved") return `p. ${o + 1} → p. ${c + 1}`;
  return o === c || c == null ? `p. ${o + 1}` : `p. ${o + 1} / ${c + 1}`;
}

function renderList() {
  const list = $("change-list");
  list.replaceChildren(
    ...state.changes
      .filter((change) => !state.hidden.has(change.type))
      .map((change) => {
        const item = document.createElement("li");
        item.className = `change${change.id === state.selectedId ? " selected" : ""}`;
        item.dataset.id = change.id;
        item.dataset.type = change.type;
        const o = escapeHtml(change.original.display);
        const n = escapeHtml(change.changed.display);
        // Inline redline: context words, deleted text struck through in red, inserted text in green.
        const before = change.context.before ? `<span class="ctx">…${escapeHtml(change.context.before)} </span>` : "";
        const after = change.context.after ? `<span class="ctx"> ${escapeHtml(change.context.after)}…</span>` : "";
        let body;
        if (change.type === "replaced") body = `${before}<span class="old">${o}</span> <span class="new">${n}</span>${after}`;
        else if (change.type === "deleted") body = `${before}<span class="old">${o}</span>${after}`;
        else if (change.type === "inserted") body = `${before}<span class="new">${n}</span>${after}`;
        else body = `<span class="moved-text">${o}</span>`;
        item.innerHTML = `<div class="meta"><span class="badge ${change.type}">${TYPE_LABELS[change.type]}</span><span>${pageLabel(change)}</span></div><div class="excerpt">${body}</div>`;
        item.addEventListener("click", () => selectChange(change.id));
        return item;
      }),
  );
}

/** The change whose highlighted text contains the point, on one side. */
function changeAt(sideName, pageIndex, point) {
  if (pageIndex == null || !point) return null;
  const hit = state.changes.find((change) => {
    const side = change[sideName];
    return (
      side.pageIndex === pageIndex &&
      side.rects.some(([l, t, w, h]) => point.x >= l - 2 && point.x <= l + w + 2 && point.y >= t - 2 && point.y <= t + h + 2)
    );
  });
  return hit?.id ?? null;
}

/** Goes to the change in both documents and frames it. */
async function selectChange(id, { scrollList = false } = {}) {
  const change = state.changes.find((c) => c.id === id);
  if (!change) return;
  state.selectedId = id;
  document.querySelectorAll(".change").forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  if (scrollList) document.querySelector(`.change[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });

  for (const sideName of ["original", "changed"]) {
    const instance = state.viewers[sideName];
    const side = change[sideName];
    if (!instance) continue;
    if (state.focusAnnotations[sideName].length) {
      await instance.delete(state.focusAnnotations[sideName]);
      state.focusAnnotations[sideName] = [];
    }
    if (side.pageIndex == null) continue;
    const box = side.rects.length ? union(side.rects) : side.marker ? [side.marker[0] - 2, side.marker[1] - 12, 4, 12] : null;
    if (!box) continue;
    const padded = [box[0] - 4, box[1] - 4, box[2] + 8, box[3] + 8];
    const [focus] = await instance.create(
      new SDK.Annotations.RectangleAnnotation({
        pageIndex: side.pageIndex,
        boundingBox: rect(padded),
        strokeColor: COLORS.focus,
        strokeWidth: 2,
        customData: { focus: true },
      }),
    );
    state.focusAnnotations[sideName] = [focus.id];
    const view = [padded[0] - 60, padded[1] - 160, padded[2] + 120, padded[3] + 320];
    instance.jumpToRect(side.pageIndex, rect(view));
  }
}

// ---------------------------------------------------------------------------
// Visual comparison

async function runVisualComparison() {
  window.comparison = { state: "loading", mode: "visual" };
  const [originalData, changedData] = await Promise.all([loadSource(state.pair.original), loadSource(state.pair.changed)]);
  const instance = await SDK.load({
    ...viewerConfiguration("#viewer-visual", originalData.slice(0)),
    initialViewState: new SDK.ViewState({ sidebarMode: null, zoom: SDK.ZoomMode.FIT_TO_VIEWPORT }),
  });
  state.viewers.visual = instance;
  await instance.setDocumentComparisonMode({
    documentA: { source: SDK.DocumentComparisonSourceType.USE_OPEN_DOCUMENT, pageIndex: 0 },
    documentB: { source: changedData.slice(0), pageIndex: 0 },
    strokeColors: {
      documentA: new SDK.Color({ r: 245, g: 40, b: 27 }),
      documentB: new SDK.Color({ r: 49, g: 193, b: 255 }),
    },
    blendMode: "darken",
    autoCompare: true,
  });
  // Show the whole overlaid page: the comparison view opens fitted to the width.
  const page = instance.pageInfoForIndex(0);
  const box = document.getElementById("viewer-visual").getBoundingClientRect();
  const zoom = Math.min(box.width / page.width, (box.height - 100) / page.height) * 0.95;
  setTimeout(() => instance.setViewState((viewState) => viewState.set("zoom", zoom)), 500);
  window.comparison = { state: "done", mode: "visual" };
}

// ---------------------------------------------------------------------------
// Page

async function run() {
  await unloadAll();
  $("text-view").hidden = state.mode !== "text";
  $("visual-view").hidden = state.mode !== "visual";
  $("mode-text").classList.toggle("active", state.mode === "text");
  $("mode-visual").classList.toggle("active", state.mode === "visual");
  $("mode-text").setAttribute("aria-selected", state.mode === "text");
  $("mode-visual").setAttribute("aria-selected", state.mode === "visual");
  try {
    if (state.mode === "text") await runTextComparison();
    else await runVisualComparison();
  } catch (error) {
    console.error(error);
    window.comparison = { state: "error", message: String(error?.message ?? error) };
    $("summary").innerHTML = `<span class="error">${escapeHtml(String(error?.message ?? error))}</span>`;
  }
}

function setup() {
  const select = $("sample");
  SAMPLES.forEach((sample) => select.add(new Option(sample.label, sample.id)));
  select.add(new Option("Your files (choose two PDFs)", "files"));

  select.addEventListener("change", () => {
    const sample = SAMPLES.find((s) => s.id === select.value);
    if (!sample) return;
    state.pair = sample;
    state.mode = sample.mode;
    run();
  });

  $("pair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const a = $("file-original").files[0];
    const b = $("file-changed").files[0];
    if (a && b) {
      select.value = "files";
      state.pair = { id: "files", original: { name: a.name, file: a }, changed: { name: b.name, file: b } };
    }
    run();
  });

  $("mode-text").addEventListener("click", () => switchMode("text"));
  $("mode-visual").addEventListener("click", () => switchMode("visual"));

  // ?mode=visual&sample=plan selects a mode and a sample from the URL.
  const params = new URLSearchParams(location.search);
  const sample = SAMPLES.find((s) => s.id === params.get("sample"));
  if (sample) {
    state.pair = sample;
    state.mode = sample.mode;
  }
  if (params.get("mode") === "visual" || params.get("mode") === "text") state.mode = params.get("mode");
  select.value = state.pair.id;
  run();
}

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  // Switching mode on a sample picks the sample made for that mode.
  if (state.pair.id !== "files") {
    state.pair = SAMPLES.find((s) => s.mode === mode) ?? state.pair;
    $("sample").value = state.pair.id;
  }
  run();
}

SDK.preloadWorker?.({ licenseKey: LICENSE_KEY, useCDN: true }).catch?.(() => {});
setup();
