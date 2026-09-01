import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/deliveries/label-print/route.ts", import.meta.url), "utf8");
const events = await readFile(new URL("../app/lib/delivery-events.ts", import.meta.url), "utf8");
const deliveriesRoute = await readFile(new URL("../app/api/deliveries/route.ts", import.meta.url), "utf8");

test("label print records an internal, dispatcher-only action for only deliveries in the current company", () => {
  assert.match(route, /getDispatcherSession/);
  assert.match(route, /requestIsSameOrigin/);
  assert.match(route, /store\.listForCompany\(session\.companyId\)/);
  assert.match(route, /delivery_not_found/);
  assert.match(route, /store\.recordEvent\(delivery\.id, "LABEL_PRINT_REQUESTED", delivery\.progress\)/);
});

test("the recorded print action is shown in the dispatcher data but never leaks into public milestones", () => {
  assert.match(events, /\| "LABEL_PRINT_REQUESTED"/);
  assert.match(events, /event !== "LABEL_PRINT_REQUESTED"/);
  assert.match(deliveriesRoute, /labelPrintRequestedAt: events\.find\(\(event\) => event\.type === "LABEL_PRINT_REQUESTED"\)/);
});
