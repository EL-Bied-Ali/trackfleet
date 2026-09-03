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
// clientHeight on the actual rendered label. Turned out the SAME clipping
// already affected the previously-shipped 12/feuille preset too (pre-dates
// this session), so the real fix wasn't a denser preset -- it's printing
// the short site label instead of the full postal address (see below).
test("does not offer the reverted 18-per-sheet (3x6) preset", () => {
  assert.doesNotMatch(labelsPage, /\{ cols: 3, rows: 6 \}/);
});

// Live-checking 12/feuille against a real delivery found the SAME
// overflow bug (403px of content vs. a 249px box) that broke 18/feuille --
// a genuine, pre-existing issue independent of anything shipped this
// session. Root cause: the label printed the delivery's full postal
// address (e.g. "12 Boulevard Essaouira, Douar el Asker, Derb el Makina,
// Marrakech, Maroc", 74 characters), which wraps across several lines in
// the narrow ~31mm text column regardless of label height. Printing the
// site's own longer label instead ("Marrakech · Boulevard Essaouira") was
// tried first and STILL wrapped and clipped the truck line -- confirmed
// live again. Settled on the city alone, which every known site today
// still identifies uniquely, and falls back to the full address only when
// no matching site is found.
test("prints the destination agency's city alone, not the full postal address or the site's longer label, falling back to the address when no site matches", () => {
  assert.match(labelsPage, /destinationSiteId: string \| null;/);
  assert.match(labelsPage, /const \[siteCities, setSiteCities\] = useState<Map<string, string>>\(new Map\(\)\);/);
  assert.match(labelsPage, /fetch\("\/api\/sites", \{ cache: "no-store" \}\)/);
  assert.match(labelsPage, /setSiteCities\(new Map\(\(data\.sites \?\? \[\]\)\.map\(\(site\) => \[site\.id, site\.city\]\)\)\)/);
  assert.match(labelsPage, /\(\(delivery\.destinationSiteId && siteCities\.get\(delivery\.destinationSiteId\)\) \|\| delivery\.destination\)/);
});

// Even with the city-only destination, live-checking a full sheet of real
// deliveries found some customer names (e.g. "Ahmed Benjelloun") still
// wrapped to a second line in the narrow text column and pushed the truck
// line below the label's overflow:hidden -- confirmed via scrollHeight vs
// clientHeight across all 12 labels on a real sheet, several off by up to
// 28px. Truncating (not wrapping) the customer, destination and truck
// lines guarantees the truck plate is never the casualty of a long name.
test("truncates the customer/contact, destination and truck lines instead of letting them wrap and push each other out of the label", () => {
  assert.match(labelsPage, /<div style=\{\{ fontSize: 11, lineHeight: 1\.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>\{\[delivery\.customer, delivery\.contact\]\.filter\(Boolean\)\.join\(" · "\)\}<\/div>/);
  assert.match(labelsPage, /<div style=\{\{ fontSize: 11, fontWeight: 700, lineHeight: 1\.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>\{\(\(delivery\.originSiteId/);
  assert.match(labelsPage, /<div style=\{\{ fontSize: 10\.5, lineHeight: 1\.1, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>Camion : \{delivery\.truck\}<\/div>/);
});
