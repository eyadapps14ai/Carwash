import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { boundedJSON, boundedText, safeError } from "../lib/request-security";
import { encryptBackup, decryptBackup, restoreOrder } from "../lib/backup";
import { hashPassword, verifyPasswordAsync } from "../lib/auth";
test("bounded request parsing rejects oversized declared and chunked bodies and malformed JSON", async () => {
  await assert.rejects(
    () =>
      boundedText(
        new Request("http://example.test", {
          method: "POST",
          headers: { "content-length": "100" },
          body: "x",
        }),
        10,
      ),
    /too large/,
  );
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("123456"));
      c.enqueue(new TextEncoder().encode("789012"));
      c.close();
    },
  });
  await assert.rejects(
    () =>
      boundedText(
        new Request("http://example.test", {
          method: "POST",
          body: stream,
          duplex: "half",
        } as any),
        10,
      ),
    /too large/,
  );
  await assert.rejects(
    () =>
      boundedJSON(
        new Request("http://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
      ),
    /Invalid JSON/,
  );
});
test("async password verification rejects malformed hashes and incorrect passwords", async () => {
  const hash = hashPassword("test-password-123");
  assert.equal(await verifyPasswordAsync("test-password-123", hash), true);
  assert.equal(await verifyPasswordAsync("wrong", hash), false);
  assert.equal(await verifyPasswordAsync("test", "invalid:hash"), false);
});
test("encrypted backups detect wrong keys and ciphertext tampering and preserve decimal strings", () => {
  const key = randomBytes(32),
    data = { amount: "1234567890.01", contact: "private@example.test" },
    encrypted = encryptBackup(data, key);
  assert.equal(encrypted.includes(Buffer.from(data.contact)), false);
  assert.deepEqual(decryptBackup(encrypted, key), data);
  assert.throws(() => decryptBackup(encrypted, randomBytes(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key));
  const order = restoreOrder();
  assert.ok(order.indexOf("Sale") < order.indexOf("Payment"));
  assert.ok(order.indexOf("Voucher") < order.indexOf("MarketingDelivery"));
});
test("database errors do not reveal connection details", () => {
  class PrismaClientInitializationError extends Error {}
  assert.equal(
    safeError(new PrismaClientInitializationError("secret connection URL")),
    "Data is temporarily unavailable",
  );
});
