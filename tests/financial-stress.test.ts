import test from "node:test";
import assert from "node:assert/strict";
import { saleTotals } from "../lib/finance";
test("1000 varied invoice totals match an independent integer-cent VAT calculation", () => {
  let state = 610006;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const cents = (n: bigint) =>
    `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
  for (let i = 0; i < 1000; i++) {
    const prices = Array.from({ length: 1 + (random() % 12) }, () =>
      BigInt(random() % 100000000),
    );
    const subtotal = prices.reduce((a, b) => a + b, 0n),
      discount = BigInt(random()) % (subtotal + 1n),
      net = subtotal - discount,
      rate = BigInt(random() % 10001),
      vat = (net * rate + 5000n) / 10000n;
    const result = saleTotals(
      prices.map((p) => ({ price: cents(p), cost: "0.01" })),
      cents(discount),
      `${rate / 100n}.${String(rate % 100n).padStart(2, "0")}`,
    );
    assert.equal(result.net.toFixed(2), cents(net));
    assert.equal(result.vat.toFixed(2), cents(vat));
    assert.equal(result.total.toFixed(2), cents(net + vat));
  }
});
