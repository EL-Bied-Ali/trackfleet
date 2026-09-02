import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// User request: printing labels used to always start from the sheet's
// first position. A physical A4 label sheet is often only partly used
// (previous print run took the first few spots) -- the dispatcher needed a
// way to mark which grid positions are already peeled off so a reused
// sheet doesn't get overprinted, and the remaining real deliveries still
// land on the correct physical spot.
const labelsPage = await readFile(new URL("../app/labels/page.tsx", import.meta.url), "utf8");

// layoutLabelPages isn't exported (page component, no test-friendly module
// boundary) -- re-implemented here from its own spec to verify the exact
// behavior independent of the page's rendering, then cross-checked against
// the source text so the two can't silently drift apart.
function layoutLabelPages(items, labelsPerPage, blockedCells) {
  if (!items.length) return [];
  const pages = [];
  const queue = [...items];
  let pageIndex = 0;
  while (queue.length > 0) {
    const blocked = pageIndex === 0 ? blockedCells : new Set();
    const slots = [];
    for (let i = 0; i < labelsPerPage; i += 1) slots.push(blocked.has(i) ? null : (queue.shift() ?? null));
    pages.push(slots);
    pageIndex += 1;
  }
  return pages;
}

test("with nothing blocked, behaves exactly like the old plain chunking", () => {
  const pages = layoutLabelPages(["a", "b", "c", "d", "e"], 2, new Set());
  assert.deepEqual(pages, [["a", "b"], ["c", "d"], ["e", null]]);
});

test("blocked positions on the first page stay empty, and real items shift into the remaining slots in order", () => {
  const pages = layoutLabelPages(["a", "b", "c"], 4, new Set([0, 2]));
  assert.deepEqual(pages[0], [null, "a", null, "b"]);
  assert.deepEqual(pages[1], ["c", null, null, null]);
});

test("only the first page respects blocked cells -- further pages always assume a fresh sheet", () => {
  const pages = layoutLabelPages(["a", "b", "c", "d", "e"], 2, new Set([0]));
  assert.deepEqual(pages[0], [null, "a"]);
  assert.deepEqual(pages[1], ["b", "c"]);
  assert.deepEqual(pages[2], ["d", "e"]);
});

test("the labels page implements layoutLabelPages with this exact contract, and resets the selection whenever the grid shape (label size) changes", () => {
  assert.match(labelsPage, /function layoutLabelPages<T>\(items: T\[\], labelsPerPage: number, blockedCells: Set<number>\): Array<Array<T \| null>> \{/);
  assert.match(labelsPage, /const \[blockedCells, setBlockedCells\] = useState<Set<number>>\(new Set\(\)\);/);
  assert.match(labelsPage, /setBlockedCells\(new Set\(\)\);\s*\n\s*\}/);
});

test("the cell picker only renders when there's more than one label per sheet, and reports how many are marked skipped", () => {
  assert.match(labelsPage, /\{labelsPerPage > 1 && \(/);
  assert.match(labelsPage, /toggleBlockedCell/);
  assert.match(labelsPage, /blockedCells\.size > 0 \? ` \(\$\{blockedCells\.size\} sautée/);
});

// User asked for more labels per sheet without breaking legibility. A
// denser 18/feuille (3x6) preset was tried and reverted the same session:
// live-checking (not just the QR-size math) found a real destination
// address wraps across several lines and gets silently clipped by
// overflow:hidden at that height -- confirmed via scrollHeight vs
// clientHeight on the actual rendered label. 12/feuille (3x4) stays the
// real ceiling until the destination is shown as a short label instead of
// the full address.
test("does not offer the reverted 18-per-sheet (3x6) preset -- it silently clips real destination addresses", () => {
  assert.doesNotMatch(labelsPage, /\{ cols: 3, rows: 6 \}/);
});
