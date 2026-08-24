import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { knownSites } from "../app/lib/known-sites.ts";

test("the delivery corridor is strictly cross-border: exactly one Belgian site, the rest Moroccan", () => {
  // The destination restriction below only makes sense if there's exactly
  // one site per side of the corridor to fall back to -- if a second BE (or
  // MA) site were ever added, a Moroccan agency filtered to "not MA" would
  // suddenly see more than one option, which is still correct behavior, but
  // worth knowing this test's "the only option is Brussels" framing would
  // need revisiting.
  const belgian = knownSites.filter((site) => site.country === "BE");
  assert.equal(belgian.length, 1);
  assert.equal(belgian[0].id, "brussels-abattoir-45");
});

test("an agency's destination options in the creation form are restricted to the other country", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // A Moroccan agency registering a parcel is always shipping cross-border --
  // there's no MA-to-MA agency drop-off use case -- so the destination
  // picker must exclude every site sharing the agency's own country, not
  // just hardcode "show Brussels for Morocco": the same rule then also
  // correctly restricts a (hypothetical) Belgian agency to Moroccan
  // destinations only, instead of needing a second special case.
  assert.match(
    page,
    /knownSites\.filter\(\(site\) => site\.roles\.includes\("destination"\) && \(company\?\.role !== "agency" \|\| site\.country !== creationOriginCountry\)\)/,
  );
});
