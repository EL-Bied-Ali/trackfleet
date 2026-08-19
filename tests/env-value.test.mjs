import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEnvValue } from "../app/lib/env-value.ts";
import { decodeSessionEncryptionKey } from "../app/lib/session-encryption-key.ts";

test("normalizes plain and quoted environment values", () => {
  assert.equal(normalizeEnvValue(" value "), "value");
  assert.equal(normalizeEnvValue(' "value" '), "value");
  assert.equal(normalizeEnvValue(" 'value' "), "value");
  assert.equal(normalizeEnvValue("\"mismatched'"), "\"mismatched'");
});

test("accepts a quoted 32-byte base64 session key", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  assert.equal(decodeSessionEncryptionKey(key)?.byteLength, 32);
  assert.equal(decodeSessionEncryptionKey(`\"${key}\"`)?.byteLength, 32);
  assert.equal(decodeSessionEncryptionKey(`'${key}'`)?.byteLength, 32);
});
