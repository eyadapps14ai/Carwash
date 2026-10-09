import test from "node:test";
import assert from "node:assert/strict";
import {
  weightedStockCost,
  estimatedLineCost,
  attributedRevenue,
  jobTransitions,
  hoursBetween,
} from "../lib/operations";
import { productivityReport } from "../lib/operations-data";
test("weighted receipts and replacement inventory costs retain direct costs without double-counting", () => {
  assert.equal(weightedStockCost("20", "2", "10", "5").toFixed(6), "3.000000");
  assert.equal(
    estimatedLineCost(
      "50",
      [
        { name: "Chemicals", mode: "FIXED", amount: "10" },
        { name: "Direct work", mode: "FIXED", amount: "5" },
        { name: "Salary", mode: "FIXED", amount: "8", source: "PAYROLL" },
      ],
      [{ itemId: "a", quantity: "1", replaceCostNames: ["Chemicals"] }],
      [{ itemId: "a", unitCost: "3" }],
    ).toFixed(2),
    "8.00",
  );
});
test("team revenue allocation preserves every cent and employee duplication does not duplicate revenue", () => {
  assert.deepEqual(attributedRevenue("10.01", ["c", "a", "b", "a"]), {
    a: "3.34",
    b: "3.34",
    c: "3.33",
  });
  assert.deepEqual(attributedRevenue("0", []), {});
});
test("finished job states cannot consume stock again or cancel previously completed work", () => {
  assert.deepEqual(jobTransitions.COMPLETED, ["DELIVERED"]);
  assert.deepEqual(jobTransitions.DELIVERED, []);
  assert.ok(!jobTransitions.NEW.includes("COMPLETED"));
  assert.equal(
    hoursBetween("2026-10-08T00:00:00Z", "2026-10-08T02:30:00Z"),
    2.5,
  );
});
test("productivity clips overnight attendance to Dubai date range and attributes shared revenue once", () => {
  const data = {
    staff: [
      { id: "a", name: "A", branches: [{ branchId: "one" }] },
      { id: "b", name: "B", branches: [{ branchId: "one" }] },
    ],
    jobs: [],
    times: [],
    attendance: [
      {
        userId: "a",
        branchId: "one",
        startedAt: "2026-10-07T23:00:00+04:00",
        endedAt: "2026-10-08T02:00:00+04:00",
      },
    ],
    sales: [
      {
        net: "10.01",
        branchId: "one",
        createdAt: "2026-10-08T12:00:00+04:00",
        workers: [{ userId: "a" }, { userId: "b" }],
        lines: [{ name: "Wash", category: "Car washing" }],
      },
    ],
  };
  const r = productivityReport(
    data,
    ["one"],
    "2026-10-08",
    "2026-10-08",
    new Date("2026-10-08T18:00:00+04:00"),
  );
  assert.equal(r[0].attendanceHours, 2);
  assert.equal(r[0].revenue, "5.01");
  assert.equal(r[1].revenue, "5.00");
  assert.equal(r[0].servicesPerHour, 0.5);
  assert.equal(r[0].washes, 1);
  assert.equal(r[1].jobHours, 0);
});

import { inventoryUsage } from "../lib/operations";
test("material usage aggregates only consumption, separately from receipts and transfers", () => {
  const base = {
    branchId: "a",
    itemId: "one",
    item: { name: "Oil", sku: "OIL", unit: "litre" },
  };
  const r = inventoryUsage([
    { ...base, kind: "RECEIPT", quantity: "20", value: "60" },
    { ...base, kind: "TRANSFER_OUT", quantity: "-5", value: "-15" },
    { ...base, kind: "CONSUMPTION", quantity: "-1.5", value: "-4.50" },
    { ...base, kind: "CONSUMPTION", quantity: "-0.5", value: "-1.50" },
  ]);
  assert.equal(r[0].quantity, "2.0000");
  assert.equal(r[0].cost, "6.00");
});

test("sub-minute time does not produce an hourly rate alongside zero displayed hours", () => {
  const data = {
    staff: [{ id: "a", name: "A", branches: [{ branchId: "one" }] }],
    jobs: [],
    times: [],
    attendance: [
      {
        userId: "a",
        branchId: "one",
        startedAt: "2026-10-08T12:00:00+04:00",
        endedAt: "2026-10-08T12:00:01+04:00",
      },
    ],
    sales: [
      {
        net: "10",
        branchId: "one",
        createdAt: "2026-10-08T12:00:00+04:00",
        workers: [{ userId: "a" }],
        lines: [
          { serviceId: "wash", name: "Wash", category: "Washing" },
          {
            serviceId: "inventory:item",
            name: "Part",
            category: "Spare parts",
          },
        ],
      },
    ],
  };
  const r = productivityReport(
    data,
    ["one"],
    "2026-10-08",
    "2026-10-08",
    new Date("2026-10-08T18:00:00+04:00"),
  );
  assert.equal(r[0].services, 1);
  assert.equal(r[0].servicesPerHour, null);
});
