import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCustomerPhone } from "../app/lib/customer-contact.ts";

test("normalizes international WhatsApp recipient formats", () => {
  assert.equal(normalizeCustomerPhone("+212 6 12 34 56 78"), "212612345678");
  assert.equal(normalizeCustomerPhone("0032 470 12 34 56"), "32470123456");
  assert.equal(normalizeCustomerPhone("212612345678"), "212612345678");
});

test("keeps empty contact optional but rejects ambiguous local numbers", () => {
  assert.equal(normalizeCustomerPhone(""), "");
  assert.equal(normalizeCustomerPhone("0612345678"), null);
  assert.equal(normalizeCustomerPhone("0470 12 34 56"), null);
  assert.equal(normalizeCustomerPhone("123"), null);
});
