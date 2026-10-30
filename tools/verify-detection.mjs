// Checks that the text comparison finds every edit made to the sample contract.
//
// Starts the static server, opens the app in headless Chromium, waits for the comparison
// and matches the changes against public/samples/expected-changes.json.
//
// Usage:
//   npm run verify
//   npm run verify -- --screenshots docs/screenshots
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.VERIFY_PORT || 4519);
const shotsArg = process.argv.indexOf("--screenshots");
const shotsDir = shotsArg > 0 ? join(root, process.argv[shotsArg + 1]) : null;

const normalize = (text) => (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const contains = (haystack, needle) => normalize(needle) !== "" && normalize(haystack).includes(normalize(needle));
// The change text is a meaningful part of the edited text (not a single digit or letter).
const partOf = (text, edited) => normalize(text).length >= 3 && contains(edited, text);

/** True when the change shows the edit: same kind, same page, and the edited text on each side. */
function matches(edit, change) {
  const page = edit.page - 1;
  const o = change.original;
  const c = change.changed;
  switch (edit.kind) {
    case "replacement":
      return (
        change.type === "replaced" &&
        o.pageIndex === page &&
        (contains(o.display, edit.original) || partOf(o.display, edit.original)) &&
        (contains(c.display, edit.changed) || partOf(c.display, edit.changed))
      );
    case "deletion":
      return change.type === "deleted" && o.pageIndex === page && contains(o.text, edit.original);
    case "insertion":
      return change.type === "inserted" && c.pageIndex === page && contains(c.text, edit.changed);
    case "move":
      return change.type === "moved" && contains(o.text, edit.original) && contains(c.text, edit.changed);
    default:
      return false;
  }
}

async function waitForServer(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start on ${url}`);
}

const server = spawn(process.execPath, [join(root, "server.mjs")], {
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});

let exitCode = 1;
try {
  const base = `http://localhost:${port}`;
  await waitForServer(`${base}/config.js`);
  const expected = JSON.parse(await readFile(join(root, "public/samples/expected-changes.json"), "utf8"));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?sample=contract`);
  await page.waitForFunction(() => window.comparison?.state && window.comparison.state !== "loading", null, { timeout: 180000 });
  const result = await page.evaluate(() => ({
    state: window.comparison.state,
    message: window.comparison.message,
    summary: window.comparison.summary,
    elapsedMs: window.comparison.elapsedMs,
    changes: window.comparison.changes,
  }));
  if (result.state !== "done") throw new Error(`Comparison failed: ${result.message}`);

  const used = new Set();
  console.log(`Text comparison: ${result.summary.total} changes in ${result.elapsedMs} ms`);
  console.log("");
  let found = 0;
  for (const edit of expected.contract.edits) {
    const change = result.changes.find((c) => !used.has(c.id) && matches(edit, c));
    if (change) {
      used.add(change.id);
      found += 1;
    }
    const shown = change
      ? `${change.type} ${change.id}: "${change.original.display.slice(0, 40)}" -> "${change.changed.display.slice(0, 40)}"`
      : "NOT FOUND";
    console.log(`${change ? "found  " : "missing"}  ${edit.id.padEnd(20)} ${edit.kind.padEnd(12)} ${shown}`);
  }
  const others = result.changes.filter((c) => !used.has(c.id));
  console.log("");
  console.log(`${found} of ${expected.contract.edits.length} edits found.`);
  if (others.length) {
    console.log(`${others.length} other change(s), not in the list of edits:`);
    others.forEach((c) => console.log(`  ${c.type} p. ${c.original.pageIndex + 1}: "${c.original.display}" -> "${c.changed.display}"`));
  }

  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    const paymentTerm = result.changes.find((c) => c.original.display.includes("thirty"));
    await page.waitForTimeout(1500);
    if (paymentTerm) await page.click(`.change[data-id="${paymentTerm.id}"]`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(shotsDir, "01-text-comparison.png") });
    const moved = result.changes.find((c) => c.type === "moved");
    if (moved) await page.click(`.change[data-id="${moved.id}"]`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(shotsDir, "03-moved-paragraph.png") });
    await page.goto(`${base}/?sample=plan`);
    await page.waitForFunction(() => window.comparison?.state && window.comparison.state !== "loading", null, { timeout: 180000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(shotsDir, "02-visual-comparison.png") });
    console.log(`Screenshots written to ${shotsDir}`);
  }
  await browser.close();
  exitCode = found === expected.contract.edits.length ? 0 : 2;
} catch (error) {
  console.error(error.message);
} finally {
  server.kill();
}
process.exit(exitCode);
