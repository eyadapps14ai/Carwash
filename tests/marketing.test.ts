import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  voucherDiscount,
  eligibleNet,
  fullyPaid,
  inactiveDays,
  renderMarketingMessage,
} from "../lib/marketing";
import { verifyMeta, verifyResend } from "../lib/webhook-signature";
const rules = {
  branchIds: ["a"],
  serviceIds: ["wash"],
  discountKind: "PERCENT",
  discountValue: "15",
  minimumSpend: "100",
  campaignName: "Test",
};
test("voucher discounts use eligible service prices and cap fixed discounts", () => {
  const lines = [
    { serviceId: "wash", price: "101.25" },
    { serviceId: "oil", price: "100" },
  ];
  assert.equal(voucherDiscount(rules, "a", lines).toFixed(2), "15.19");
  assert.equal(
    voucherDiscount(
      { ...rules, discountKind: "FIXED", discountValue: "999" },
      "a",
      lines,
    ).toFixed(2),
    "101.25",
  );
  assert.throws(() => voucherDiscount(rules, "b", lines));
  assert.throws(() =>
    voucherDiscount(rules, "a", [{ serviceId: "wash", price: "99" }]),
  );
  assert.throws(() =>
    voucherDiscount(rules, "a", [{ serviceId: "oil", price: "150" }]),
  );
});
test("free reward discounts one lowest-price eligible line", () =>
  assert.equal(
    voucherDiscount(
      { ...rules, discountKind: "FREE_SERVICE", minimumSpend: "0" },
      "a",
      [
        { serviceId: "wash", price: "60" },
        { serviceId: "wash", price: "40" },
        { serviceId: "oil", price: "10" },
      ],
    ).toFixed(2),
    "40.00",
  ));
test("loyalty eligible net spending apportions invoice discounts once", () => {
  assert.equal(
    eligibleNet(
      {
        net: "90",
        subtotal: "100",
        lines: [
          { serviceId: "wash", price: "60" },
          { serviceId: "oil", price: "40" },
        ],
      },
      ["wash"],
    ).toFixed(2),
    "54.00",
  );
  assert.equal(
    eligibleNet({ net: "0", subtotal: "0", lines: [] }, ["wash"]).toFixed(2),
    "0.00",
  );
  assert.equal(
    fullyPaid({
      status: "COMPLETED",
      total: "105",
      payments: [{ amount: "100" }],
    }),
    false,
  );
  assert.equal(
    fullyPaid({ status: "CANCELLED", total: "0", payments: [] }),
    false,
  );
});
test("reactivation uses Dubai calendar days and messages preserve dynamic text", () => {
  assert.equal(
    inactiveDays(
      new Date("2026-10-01T20:30:00Z"),
      new Date("2026-10-03T00:00:00Z"),
    ),
    1,
  );
  assert.equal(
    renderMarketingMessage("Hi {name}: {code} {unsubscribe}", {
      name: "Customer $&",
      code: "PT-ABC",
      unsubscribe: "https://example.test/u",
    }),
    "Hi Customer $&: PT-ABC https://example.test/u",
  );
});
test("provider signatures reject tampering and old/replayed-time requests", () => {
  const body = '{"status":"delivered"}',
    secret = "testing-secret",
    sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyMeta(body, sig, secret), true);
  assert.equal(verifyMeta(body + "x", sig, secret), false);
  const key = Buffer.from("svix-secret"),
    timestamp = "1791450000",
    id = "evt_test",
    signature = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64"),
    headers = new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": "v1," + signature,
    });
  assert.equal(
    verifyResend(
      body,
      headers,
      "whsec_" + key.toString("base64"),
      Number(timestamp) * 1000,
    ),
    true,
  );
  assert.equal(
    verifyResend(
      body,
      headers,
      "whsec_" + key.toString("base64"),
      Number(timestamp) * 1000 + 301000,
    ),
    false,
  );
});
