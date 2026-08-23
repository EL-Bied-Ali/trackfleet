import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("the customer-view and dashboard JSX trees are wrapped in nested functions, not inlined in Home's own body", () => {
  // Live incident: GET / intermittently exceeded Cloudflare's Worker CPU
  // time limit (error 1102), confirmed via `wrangler tail`. authState starts
  // "loading" and view starts "dispatch" on every render -- including the
  // very first server-rendered one -- so the SSR pass for every request
  // (dashboard, login, or a customer tracking link) always takes the tiny
  // loading-shell early return and never actually executes either of these
  // two large JSX trees. But V8 must still fully parse/compile a function's
  // entire body the first time it's *called*, and this file is one ~1300
  // line function -- so the cost of compiling both unreached trees was
  // being paid on every cold isolate anyway. Wrapping them in their own
  // nested functions lets V8 defer compiling their bodies until they're
  // actually invoked, which (for the customer/dashboard branches) is never
  // during SSR.
  assert.match(page, /function renderCustomerView\(\) \{/);
  assert.match(page, /if \(view === "customer"\) return renderCustomerView\(\);/);
  assert.match(page, /function renderDashboard\(\) \{/);
  assert.match(page, /return renderDashboard\(\);\r?\n\}/);
});

test("neither extracted function calls a React hook directly -- they must stay plain closures, not components", () => {
  // If either one called a hook (useState, useMemo, etc.) directly, this
  // would be a real Rules-of-Hooks violation: they're invoked conditionally
  // (only once view/authState resolve past the loading shell), and a hook
  // call inside a conditionally-invoked function breaks React's per-render
  // hook-call-order guarantee. Every piece of state/memoized value they use
  // must already be computed above, in Home()'s own unconditional hook
  // sequence, and simply closed over by these nested functions.
  const start = page.indexOf("function renderCustomerView() {");
  const end = page.indexOf("return renderDashboard();");
  assert.ok(start > -1 && end > start, "expected both markers to be present and in order");
  const body = page.slice(start, end);
  assert.doesNotMatch(body, /\buseState\(|\buseMemo\(|\buseEffect\(|\buseCallback\(|\buseRef\(/);
});
