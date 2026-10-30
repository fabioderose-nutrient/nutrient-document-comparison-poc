// Turns the result of instance.compareDocuments() into a list of changes:
// replaced, inserted, deleted and moved text, with the rectangles of each side.
//
// The SDK returns, per page pair, hunks of operations (equal, delete, insert).
// Consecutive delete and insert operations form one change. Equal operations
// around them give the context, used to show whole words when the SDK reports
// part of a word (for example "2,50" -> "3,75" inside "12,500" -> "13,750").
// A deleted passage that comes back as an insertion elsewhere is reported as a move.

const MIN_MOVE_LENGTH = 25;
const MOVE_SIMILARITY = 0.9;

export function buildChanges(result) {
  const changes = [];
  let ignored = 0;
  for (const page of result?.documentComparisonResults ?? []) {
    for (const comparison of page.comparisonResults ?? []) {
      for (const hunk of comparison.hunks ?? []) {
        for (const group of groupOperations(hunk.operations ?? [])) {
          const change = toChange(group, page.originalPageIndex, page.changedPageIndex);
          if (change) changes.push(change);
          else ignored += 1;
        }
      }
    }
  }
  const merged = detectMoves(changes);
  merged.sort(byPosition);
  merged.forEach((change, index) => (change.id = `c${index + 1}`));
  return { changes: merged, ignoredWhitespaceChanges: ignored, summary: summarize(merged) };
}

/** Splits the operations of a hunk into groups of consecutive delete and insert operations. */
function groupOperations(operations) {
  const groups = [];
  let current = null;
  operations.forEach((op, index) => {
    if (op.type === "equal") {
      if (current) {
        current.after = op.text;
        groups.push(current);
        current = null;
      }
      return;
    }
    if (!current) {
      const previous = operations[index - 1];
      current = { before: previous?.type === "equal" ? previous.text : "", after: "", ops: [] };
    }
    current.ops.push(op);
  });
  if (current) groups.push(current);
  return groups;
}

function toChange(group, originalPageIndex, changedPageIndex) {
  const deleted = group.ops.filter((op) => op.type === "delete");
  const inserted = group.ops.filter((op) => op.type === "insert");
  const deletedText = deleted.map((op) => op.text).join("");
  const insertedText = inserted.map((op) => op.text).join("");
  if (!clean(deletedText) && !clean(insertedText)) return null; // line breaks or spaces only

  // Complete words cut by the character diff with the context around the change.
  const head = /\S$/.test(group.before) && /^\S/.test(deletedText || insertedText) ? group.before.match(/\S+$/)[0] : "";
  const tail = /^\S/.test(group.after) && /\S$/.test(deletedText || insertedText) ? group.after.match(/^\S+/)[0] : "";

  const type = deletedText && insertedText ? "replaced" : deletedText ? "deleted" : "inserted";
  return {
    type,
    original: side(originalPageIndex, deletedText, head, tail, deleted, inserted, "originalTextBlocks"),
    changed: side(changedPageIndex, insertedText, head, tail, inserted, deleted, "changedTextBlocks"),
    // Context words around the change, without the word parts already shown in the change.
    context: {
      before: clean(head ? group.before.slice(0, -head.length) : group.before),
      after: clean(tail ? group.after.slice(tail.length) : group.after),
    },
  };
}

function side(pageIndex, text, head, tail, ownOps, otherOps, blocksKey) {
  const rects = ownOps.flatMap((op) => op[blocksKey].map((block) => block.rect)).filter((r) => r[2] > 0 && r[3] > 0);
  // Where the text would be on this side when it only exists on the other side.
  const marker = rects.length ? null : otherOps.flatMap((op) => op[blocksKey].map((block) => block.rect))[0] ?? null;
  return {
    pageIndex: pageIndex ?? null,
    text: clean(text),
    display: text ? clean(head + text + tail) : "",
    rects,
    marker,
  };
}

function detectMoves(changes) {
  const deletions = changes.filter((c) => c.type === "deleted" && normalize(c.original.text).length >= MIN_MOVE_LENGTH);
  const insertions = changes.filter((c) => c.type === "inserted" && normalize(c.changed.text).length >= MIN_MOVE_LENGTH);
  const used = new Set();
  const moves = [];
  for (const deletion of deletions) {
    let best = null;
    let bestScore = 0;
    for (const insertion of insertions) {
      if (used.has(insertion)) continue;
      const score = similarity(deletion.original.text, insertion.changed.text);
      if (score > bestScore) {
        best = insertion;
        bestScore = score;
      }
    }
    if (best && bestScore >= MOVE_SIMILARITY) {
      used.add(best);
      used.add(deletion);
      moves.push({
        type: "moved",
        similarity: Math.round(bestScore * 100) / 100,
        original: { ...deletion.original, display: deletion.original.text, marker: null },
        changed: { ...best.changed, display: best.changed.text, marker: null },
        context: { before: "", after: "" },
      });
    }
  }
  return changes.filter((c) => !used.has(c)).concat(moves);
}

/** Dice coefficient on words: 1 when both passages have the same words. */
export function similarity(a, b) {
  const words = (text) => normalize(text).split(" ").filter(Boolean);
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const counts = new Map();
  wa.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  let common = 0;
  wb.forEach((w) => {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      common += 1;
      counts.set(w, n - 1);
    }
  });
  return (2 * common) / (wa.length + wb.length);
}

function byPosition(a, b) {
  const pa = position(a);
  const pb = position(b);
  return pa.page - pb.page || pa.top - pb.top || pa.left - pb.left;
}

function position(change) {
  const s = change.type === "inserted" ? change.changed : change.original;
  const r = s.rects[0] ?? s.marker ?? [0, 0, 0, 0];
  return { page: s.pageIndex ?? 0, top: r[1], left: r[0] };
}

function summarize(changes) {
  const summary = { total: changes.length, replaced: 0, inserted: 0, deleted: 0, moved: 0 };
  changes.forEach((c) => (summary[c.type] += 1));
  return summary;
}

function clean(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export function normalize(text) {
  return clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
