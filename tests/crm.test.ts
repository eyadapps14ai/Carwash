import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMobile,
  plateKey,
  customerStats,
  canMarket,
  customerReportRows,
} from "../lib/crm";
test("UAE and international mobile normalization deduplicates formatting while rejecting invalid contacts", () => {
  assert.equal(normalizeMobile("050 123 4567"), "+971501234567");
  assert.equal(normalizeMobile("00971-50-123-4567"), "+971501234567");
  assert.equal(normalizeMobile("+971501234567"), "+971501234567");
  assert.equal(normalizeMobile(""), null);
  assert.throws(() => normalizeMobile("abc"));
  assert.throws(() => normalizeMobile("123"));
  assert.equal(plateKey("Dubai A-123"), "DUBAIA123");
});
test("customer spending counts completed invoices once and separates net sales, VAT billing and payments", () => {
  const rows = [
    {
      createdAt: "2026-10-08T12:00:00+04:00",
      status: "COMPLETED",
      net: "100",
      total: "105",
      payments: [{ amount: "20" }, { amount: "30" }],
    },
    {
      createdAt: "2026-10-08T12:00:00+04:00",
      status: "CANCELLED",
      net: "1000",
      total: "1050",
      payments: [],
    },
  ];
  assert.deepEqual(customerStats(rows), {
    visits: 1,
    net: "100.00",
    invoiced: "105.00",
    paid: "50.00",
    balance: "55.00",
    lastVisit: "2026-10-08",
  });
  assert.equal(customerStats([]).lastVisit, null);
});
test("contact preference alone never permits marketing; inactive or opted-out profiles cannot qualify", () => {
  const c = {
    active: true,
    marketingOptOut: true,
    consentEmail: false,
    consentWhatsApp: false,
    email: "test@example.test",
    mobile: "+971501234567",
  };
  assert.equal(canMarket(c, "EMAIL"), false);
  assert.equal(
    canMarket({ ...c, marketingOptOut: false, consentEmail: true }, "EMAIL"),
    true,
  );
  assert.equal(
    canMarket(
      { ...c, marketingOptOut: false, consentWhatsApp: true },
      "WHATSAPP",
    ),
    true,
  );
  assert.equal(
    canMarket(
      { ...c, active: false, marketingOptOut: false, consentEmail: true },
      "EMAIL",
    ),
    false,
  );
  assert.equal(
    canMarket(
      { ...c, marketingOptOut: false, consentEmail: true, email: "" },
      "EMAIL",
    ),
    false,
  );
});
test("customer reporting filters invoice dates in Dubai and keeps current payments on the selected invoices", () => {
  const rows = customerReportRows(
    [
      {
        sample: false,
        sales: [
          {
            createdAt: "2026-09-30T21:00:00Z",
            status: "COMPLETED",
            net: "50",
            total: "52.5",
            payments: [{ amount: "52.5" }],
          },
          {
            createdAt: "2026-09-30T18:00:00Z",
            status: "COMPLETED",
            net: "99",
            total: "103.95",
            payments: [],
          },
        ],
      },
    ],
    "2026-10-01",
    "2026-10-08",
  );
  assert.equal(rows[0].visits, 1);
  assert.equal(rows[0].net, "50.00");
  assert.equal(rows[0].balance, "0.00");
});
