import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const cleanup = fs.readFileSync(new URL("../scripts/canonicalize-fleet-telemetry.mjs", import.meta.url), "utf8");
const sites = fs.readFileSync(new URL("../scripts/suggest-site-coordinates.mjs", import.meta.url), "utf8");

test("fleet identity cleanup is dry-run by default and atomic when explicitly applied", () => {
  assert.match(cleanup, /process\.argv\.includes\("--apply"\)/);
  assert.match(cleanup, /if \(!apply\)/);
  assert.match(cleanup, /sql\.transaction\(\[/);
  assert.match(cleanup, /duplicate observations for the same physical truck and exact provider/);
});

test("site inference never writes medium or low confidence suggestions", () => {
  assert.match(sites, /process\.argv\.includes\("--apply-high-confidence"\)/);
  assert.match(sites, /suggestion\.confidence === "high"/);
  assert.match(sites, /latitude IS NULL/);
  assert.match(sites, /longitude IS NULL/);
  assert.match(sites, /Medium\/low suggestions are never written automatically/);
});
