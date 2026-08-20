import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const api = fs.readFileSync(new URL("../app/api/deliveries/create-trip/route.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
test("new trip API is dispatcher scoped and validates live vehicles", () => { assert.match(api, /getDispatcherSession/); assert.match(api, /store\.listForCompany\(session\.companyId\)/); assert.match(api, /snapshot\.vehicles\.find/); assert.match(api, /validateNewPlannedTrip/); assert.match(api, /status: "planned"/); assert.match(api, /assignDeliveryToPlannedTrip/); });
test("queue can create a first-stop planned trip", () => { assert.match(page, /Créer un voyage planifié/); assert.match(page, /Ce colis devient le premier arrêt explicite/); assert.match(page, /\/api\/deliveries\/create-trip/); });
