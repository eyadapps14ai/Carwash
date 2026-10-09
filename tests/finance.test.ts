import test from "node:test";
import assert from "node:assert/strict";
import {
  serviceCost,
  saleTotals,
  D,
  expenseInMonth,
  dubaiDate,
  period,
} from "../lib/finance";
import { assertAccess } from "../lib/auth";
test("AED 50 wash: cost 15, contribution 35 and margin 70%", () => {
  const cost = serviceCost(
    50,
    [2, 1, 3, 2, 7].map((amount, i) => ({
      name: String(i),
      mode: "FIXED",
      amount: String(amount),
    })),
  );
  assert.equal(cost.toString(), "15");
  assert.equal(D(50).minus(cost).toString(), "35");
  assert.equal(D(50).minus(cost).div(50).mul(100).toString(), "70");
});
test("cost methods and payroll exclusion", () =>
  assert.equal(
    serviceCost(200, [
      { name: "Water", mode: "FIXED", amount: "2" },
      { name: "Supplies", mode: "QUANTITY", amount: "3.25", quantity: "2" },
      { name: "Parts", mode: "PERCENT", amount: "10" },
      { name: "Salary", mode: "FIXED", amount: "100", source: "PAYROLL" },
    ]).toString(),
    "28.5",
  ));
test("discount precedes VAT, with decimal half-up rounding", () => {
  const t = saleTotals(
    [
      { price: "19.99", cost: "4.25" },
      { price: "30.01", cost: "5.75" },
    ],
    "5",
    "5",
  );
  assert.equal(t.subtotal.toString(), "50");
  assert.equal(t.net.toString(), "45");
  assert.equal(t.vat.toString(), "2.25");
  assert.equal(t.total.toString(), "47.25");
  assert.equal(t.cost.toString(), "10");
  assert.equal(
    saleTotals([{ price: "0.10", cost: 0 }], 0, 5).vat.toString(),
    "0.01",
  );
});
test("over-discounts and negative discounts rejected", () => {
  for (const discount of ["51", "-1"])
    assert.throws(() => saleTotals([{ price: 50, cost: 15 }], discount, 5));
});
test("historical snapshots do not depend on later prices", () => {
  const original = saleTotals([{ price: 50, cost: 15 }], 0, 5);
  saleTotals([{ price: 100, cost: 30 }], 0, 5);
  assert.equal(original.total.toString(), "52.5");
  assert.equal(original.cost.toString(), "15");
});
test("expense allocation respects start dates, months, inactive records", () => {
  const e = {
    amount: 2400,
    date: new Date("2026-10-01T00:00:00+04:00"),
    active: true,
    frequency: "ANNUAL",
  };
  assert.equal(expenseInMonth(e, "2026-10-08").toString(), "200");
  assert.equal(expenseInMonth(e, "2026-09-08").toString(), "0");
  assert.equal(
    expenseInMonth({ ...e, active: false }, "2026-10-08").toString(),
    "0",
  );
  assert.equal(
    expenseInMonth({ ...e, frequency: "ONCE" }, "2026-11-08").toString(),
    "0",
  );
});
test("Dubai boundaries correctly handle UTC month rollover and leap years", () => {
  assert.equal(dubaiDate(new Date("2026-09-30T21:00:00Z")), "2026-10-01");
  assert.equal(period("2024-02-10").days, 29);
  assert.equal(
    period("2026-12-01").end.toISOString(),
    "2026-12-31T20:00:00.000Z",
  );
});
test("role and branch checks deny cross-branch access", () => {
  const manager = { role: "MANAGER", branches: [{ branchId: "DSO" }] };
  assert.doesNotThrow(() => assertAccess(manager, ["OWNER", "MANAGER"], "DSO"));
  assert.throws(() => assertAccess(manager, ["OWNER", "MANAGER"], "DIP"));
  assert.throws(() => assertAccess(manager, ["OWNER"], "DSO"));
  assert.doesNotThrow(() =>
    assertAccess({ role: "OWNER", branches: [] }, ["OWNER"], "DIP"),
  );
});
