import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync("app/page.tsx", "utf8");

test("the site defaults to French for a visitor with no saved or requested locale", () => {
  assert.match(page, /const \[locale, setLocale\] = useState<Locale>\("fr"\);/);
});
