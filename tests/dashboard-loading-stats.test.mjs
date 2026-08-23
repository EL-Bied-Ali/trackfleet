import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");
const i18n = fs.readFileSync("app/i18n.ts", "utf8");

test("the top stat cards show what's waiting to fill the truck instead of active-deliveries/on-time-rate/delayed", () => {
  // Requested live: on-time rate and delay counts weren't what a dispatcher
  // actually watches day to day -- what matters is how many parcels have
  // piled up at the origin site (and their weight) while waiting for the
  // next truck to fill up, plus how many new parcels came in today.
  assert.match(page, /const loadingDeliveries = deliveries\.filter\(\(delivery\) => delivery\.status === "Loading"\);/);
  assert.match(page, /const loadingWeightKg = loadingDeliveries\.reduce\(\(total, delivery\) => total \+ \(delivery\.weightKg \?\? 0\), 0\);/);
  assert.match(page, /const storedTodayCount = deliveries\.filter\(\(delivery\) => delivery\.createdAt && new Date\(delivery\.createdAt\)\.toDateString\(\) === new Date\(\)\.toDateString\(\)\)\.length;/);
  assert.match(page, /<span>\{t\.loadingParcels\}<\/span>.*<strong>\{loadingDeliveries\.length\}<\/strong>/);
  assert.match(page, /<span>\{t\.loadingWeight\}<\/span>.*<strong>\{loadingWeightKg\.toLocaleString\(/);
  assert.match(page, /<span>\{t\.storedToday\}<\/span>.*<strong>\{storedTodayCount\}<\/strong>/);
  assert.doesNotMatch(page, /t\.activeDeliveries|t\.onTimeRate|t\.delayed\b|t\.needsAttention|t\.delayReasons/);
});

test("the fleet-status card (4th) is untouched, and the removed on-time/delay computations don't linger as dead code", () => {
  assert.match(page, /<span>\{t\.fleetStatus\}<\/span>/);
  assert.doesNotMatch(page, /\bonTimeRate\b/);
  assert.doesNotMatch(page, /\bcompletedWithPlan\b/);
  assert.doesNotMatch(page, /\bliveKpiCopy\b/);
  assert.doesNotMatch(page, /\bdelayedCount\b/);
});

test("the new stat-card copy exists for all three locales", () => {
  for (const [lang, ...words] of [
    ["en", "Parcels waiting to load", "Weight waiting", "Parcels registered today"],
    ["fr", "Colis en attente de chargement", "Poids en attente", "Colis enregistrés aujourd'hui"],
    ["nl", "Pakketten wachtend op lading", "Gewicht in wachtrij", "Vandaag geregistreerde pakketten"],
  ]) {
    for (const word of words) assert.ok(i18n.includes(word), `${lang} translations should include "${word}"`);
  }
});
