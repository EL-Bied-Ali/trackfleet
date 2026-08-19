import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [packageJson, lockfile] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
]);

function versionTuple(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, `expected an exact semantic version, got ${value}`);
  return match.slice(1).map(Number);
}

function atLeast(value, minimum) {
  const current = versionTuple(value);
  const floor = versionTuple(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== floor[index]) return current[index] > floor[index];
  }
  return true;
}

test("React server components stay above the July 2026 patched security floor", () => {
  assert.equal(atLeast(packageJson.dependencies.react, "19.2.8"), true);
  assert.equal(atLeast(packageJson.dependencies["react-dom"], "19.2.8"), true);
  assert.equal(atLeast(packageJson.devDependencies["react-server-dom-webpack"], "19.2.8"), true);
});

test("pnpm lockfile resolves the patched React RSC graph", () => {
  assert.match(lockfile, /react:\n\s+specifier: 19\.2\.8\n\s+version: 19\.2\.8/);
  assert.match(lockfile, /react-dom:\n\s+specifier: 19\.2\.8\n\s+version: 19\.2\.8\(react@19\.2\.8\)/);
  assert.match(lockfile, /react-server-dom-webpack:\n\s+specifier: 19\.2\.8/);
  assert.doesNotMatch(lockfile, /react-server-dom-webpack@19\.2\.6/);
});
