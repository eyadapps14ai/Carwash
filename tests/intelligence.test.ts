import test from "node:test";
import assert from "node:assert/strict";
import { D } from "../lib/finance";
import {
  allocateNet,
  buildReport,
  breakEven,
  forecastBranch,
  forecastCompany,
  investmentROI,
  expenseBetween,
  resolveExpense,
  defaultForecast,
  FinanceData,
  SaleRecord,
  ExpenseRecord,
  monthEnd,
} from "../lib/intelligence";
import {
  csvExport,
  excelExport,
  pdfExport,
  exportDatasets,
} from "../lib/exports";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
const stamp = (day: string) => `${day}T12:00:00+04:00`;
const sale = (
  id: string,
  day = "2026-10-08",
  branchId = "DSO",
): SaleRecord => ({
  id,
  number: `PT-${id}`,
  branchId,
  createdAt: stamp(day),
  status: "COMPLETED",
  plate: "DUBAI A 1",
  subtotal: "50",
  discount: "0",
  net: "50",
  vat: "2.50",
  total: "52.50",
  cost: "15",
  sample: false,
  lines: [
    {
      id: "line-" + id,
      serviceId: "wash",
      name: "Full wash",
      category: "Washing",
      price: "50",
      cost: "15",
    },
  ],
  payments: [
    {
      id: "payment-" + id,
      amount: "20",
      method: "CASH",
      createdAt: stamp(day),
    },
  ],
  workers: [{ userId: "one" }, { userId: "two" }],
});
const expense = (
  id: string,
  amount = "310",
  kind = "FIXED",
  frequency = "MONTHLY",
): ExpenseRecord => ({
  id,
  branchId: "DSO",
  category: "Rent",
  description: "Test",
  amount,
  date: stamp("2026-10-01"),
  frequency,
  kind,
  active: true,
  sample: false,
});
function source(): FinanceData {
  return {
    branches: [
      { id: "DSO", name: "DSO branch", code: "DSO", active: true },
      { id: "DIP", name: "DIP branch", code: "DIP", active: true },
    ],
    sales: [],
    expenses: [],
    investments: [],
    cashMovements: [],
    forecastConfigs: [],
    services: [],
    periodCloses: [],
  };
}
test("discount allocation preserves cents and never creates a negative service line", () => {
  const s = {
    subtotal: "0.04",
    net: "0.02",
    lines: Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      serviceId: String(i),
      name: "Micro",
      category: "Test",
      price: "0.01",
      cost: "0",
    })),
  };
  const result = allocateNet(s);
  assert.equal(result.reduce((n, v) => n.plus(v), D(0)).toString(), "0.02");
  assert.ok(result.every((v) => v.gte(0)));
  assert.deepEqual(
    result.map((v) => v.toString()),
    ["0.01", "0.01", "0", "0"],
  );
});
test("profit, tax, cash and balances remain distinct; team and branch records are not double-counted", () => {
  const d = source();
  d.sales = [sale("one"), sale("other", "2026-10-08", "DIP")];
  d.sales[0].payments.push({
    id: "later",
    amount: "32.50",
    method: "CARD",
    createdAt: stamp("2026-11-01"),
  });
  d.expenses = [
    expense("rent"),
    expense("tax", "2", "TAX", "ONCE"),
    expense("other", "5", "OTHER", "ONCE"),
  ];
  d.cashMovements = [
    {
      id: "cash",
      branchId: "DSO",
      date: stamp("2026-10-08"),
      amount: "7",
      direction: "OUT",
      category: "OPERATING",
      description: "Actual payment",
      sample: false,
    },
    {
      id: "capital",
      branchId: "DSO",
      date: stamp("2026-10-08"),
      amount: "100",
      direction: "OUT",
      category: "CAPITAL",
      description: "Capital paid",
      sample: false,
    },
  ];
  const r = buildReport(d, {
    branchIds: ["DSO"],
    start: "2026-10-01",
    end: "2026-10-08",
  });
  assert.equal(r.summary.revenue, "50.00");
  assert.equal(r.summary.vehicles, 1);
  assert.equal(r.summary.services, 1);
  assert.equal(r.summary.operatingExpenses, "80.00");
  assert.equal(r.summary.operatingProfit, "-45.00");
  assert.equal(r.summary.netProfit, "-52.00");
  assert.equal(r.summary.receipts, "20.00");
  assert.equal(r.summary.outstanding, "32.50");
  assert.equal(r.summary.recordedCashFlow, "-87.00");
  assert.equal(r.serviceRows[0].revenue, "50.00");
});
test("service filters allocate discount exactly and do not claim unallocated branch profit", () => {
  const d = source(),
    s = sale("mixed");
  s.subtotal = "100";
  s.net = "90";
  s.discount = "10";
  s.lines.push({
    id: "oil",
    serviceId: "oil",
    name: "Oil",
    category: "Oil",
    price: "50",
    cost: "20",
  });
  d.sales = [s];
  d.expenses = [expense("rent")];
  const r = buildReport(d, {
    branchIds: ["DSO"],
    start: "2026-10-01",
    end: "2026-10-08",
    serviceId: "wash",
  });
  assert.equal(r.summary.revenue, "45.00");
  assert.equal(r.summary.contribution, "30.00");
  assert.equal(r.summary.operatingProfit, null);
  assert.equal(r.summary.netProfit, null);
  assert.equal(r.summary.recordedCashFlow, null);
});
test("recurring daily allocations reconcile to cents and revisions leave previous months intact", () => {
  const e = expense("annual", "1200", "FIXED", "ANNUAL");
  let total = D(0);
  for (let i = 1; i <= 31; i++) {
    const day = `2026-10-${String(i).padStart(2, "0")}`;
    total = total.plus(expenseBetween(e, "2026-10", day, day));
  }
  assert.equal(total.toString(), "100");
  e.revisions = [
    { ...e, id: 1, effectiveMonth: "2026-10", amount: "1200" },
    { ...e, id: 2, effectiveMonth: "2026-11", amount: "2400" },
  ];
  assert.equal(resolveExpense(e, "2026-10")?.amount, "1200");
  assert.equal(resolveExpense(e, "2026-11")?.amount, "2400");
  assert.equal(resolveExpense(e, "2026-09"), null);
});
test("AED 20,000 fixed / AED 35 contribution requires 572 services, not a rounded-down target", () => {
  const r = breakEven("20000", [{ price: "50", cost: "15", weight: 1 }], 30)!;
  assert.equal(r.monthlyServices, 572);
  assert.equal(r.dailyServices, 20);
  assert.equal(r.monthlyRevenue, "28571.43");
  assert.equal(r.contribution, "35.00");
  assert.equal(r.margin, "70.00");
});
test("service mix and variable overhead affect break-even without double-counting overhead", () => {
  const r = breakEven(
    "1000",
    [
      { price: "50", cost: "15", weight: 1 },
      { price: "100", cost: "30", weight: 1 },
    ],
    30,
    "10",
  )!;
  assert.equal(r.averagePrice, "75.00");
  assert.equal(r.averageCost, "22.50");
  assert.equal(r.contribution, "45.00");
  assert.equal(r.monthlyServices, 23);
  assert.equal(
    breakEven("1000", [{ price: "10", cost: "11", weight: 1 }], 30)?.viable,
    false,
  );
  assert.equal(breakEven("1000", [], 30), null);
});
test("MTD average includes zero-sale days and scenario assumptions never alter actuals", () => {
  const d = source();
  d.sales = [sale("one", "2026-10-01")];
  const f = forecastBranch(d, "DSO", "2026-10-10");
  assert.equal(f.averageDailyRevenue, "5.00");
  assert.equal(f.remaining, 21);
  assert.equal(f.scenarios[1].revenue, "155.00");
  assert.equal(f.scenarios[0].revenue, "139.25");
  assert.equal(f.scenarios[2].revenue, "170.75");
  assert.equal(f.actual.revenue, "50.00");
  const changed = forecastBranch(d, "DSO", "2026-10-10", {
    expectedPct: "200",
    optimisticPct: "250",
  });
  assert.equal(changed.actual.revenue, "50.00");
  assert.equal(changed.scenarios[1].revenue, "260.00");
});
test("weekday history is used only with sufficient prior calendar history", () => {
  const d = source();
  for (let i = 1; i <= 30; i++)
    d.sales.push(sale("old" + i, `2026-09-${String(i).padStart(2, "0")}`));
  d.sales.push(sale("new", "2026-10-01"));
  const f = forecastBranch(d, "DSO", "2026-10-10");
  assert.ok(f.method.startsWith("Weekday averages"));
  assert.equal(f.baselineRemainingRevenue, "1050.00");
  assert.equal(f.scenarios[1].revenue, "1100.00");
  const avg = forecastBranch(d, "DSO", "2026-10-10", { basis: "AVERAGE" });
  assert.equal(avg.scenarios[1].revenue, "155.00");
});
test("company forecast reconciles to branches; month end has no remaining days or extra future expense", () => {
  const d = source();
  d.sales = [sale("one", "2026-10-01"), sale("two", "2026-10-01", "DIP")];
  const company = forecastCompany(d, ["DSO", "DIP"], "2026-10-10");
  assert.equal(company.scenarios[1].revenue, "310.00");
  const f = forecastBranch(d, "DSO", "2026-10-31", { extraExpense: "500" });
  assert.equal(f.remaining, 0);
  assert.equal(f.scenarios[1].revenue, "50.00");
  assert.equal(f.scenarios[1].operatingExpenses, "0.00");
  assert.equal(f.requiredDailyServices, null);
});
test("empty trading history yields explicit zero forecast, no invented income or payback", () => {
  const d = source();
  const f = forecastBranch(d, "DSO", "2026-10-08");
  assert.equal(f.scenarios[1].revenue, "0.00");
  assert.equal(f.requiredDailyServices, null);
  const r = investmentROI(d, "DSO", "2026-10-08");
  assert.equal(r.capitalAmount, "0.00");
  assert.equal(r.projectedRecoveryDate, null);
});
test("deposits are excluded from capital and payback requires reconciled cash and an explicit assumption", () => {
  const d = source();
  d.sales = [sale("one", "2026-10-01")];
  d.investments = [
    {
      id: "capital",
      branchId: "DSO",
      amount: "1000",
      kind: "CAPITAL",
      category: "Equipment",
      description: "Equipment",
      date: stamp("2026-10-01"),
      sample: false,
    },
    {
      id: "deposit",
      branchId: "DSO",
      amount: "500",
      kind: "DEPOSIT",
      category: "Refundable deposit",
      description: "Deposit",
      date: stamp("2026-10-01"),
      sample: false,
    },
  ];
  d.cashMovements = [
    {
      id: "cap-cash",
      investmentId: "capital",
      branchId: "DSO",
      amount: "1000",
      kind: "",
      category: "CAPITAL",
      direction: "OUT",
      description: "Capital",
      date: stamp("2026-10-01"),
      sample: false,
    },
    {
      id: "dep-cash",
      investmentId: "deposit",
      branchId: "DSO",
      amount: "500",
      category: "DEPOSIT",
      direction: "OUT",
      description: "Deposit",
      date: stamp("2026-10-01"),
      sample: false,
    },
    {
      id: "dep-return",
      investmentId: "deposit",
      branchId: "DSO",
      amount: "200",
      category: "DEPOSIT",
      direction: "IN",
      description: "Return",
      date: stamp("2026-10-02"),
      sample: false,
    },
  ] as FinanceData["cashMovements"];
  let r = investmentROI(d, "DSO", "2026-10-08");
  assert.equal(r.capitalAmount, "1000.00");
  assert.equal(r.depositHeld, "300.00");
  assert.equal(r.cumulativeOperatingCash, "20.00");
  assert.equal(r.cumulativeCashFlow, "-1280.00");
  assert.equal(r.remainingInvestment, null);
  d.forecastConfigs = [
    {
      ...defaultForecast("DSO"),
      cashReviewedThrough: "2026-10-08",
      recoveryMonthlyCash: "100",
    },
  ];
  r = investmentROI(d, "DSO", "2026-10-08");
  assert.equal(r.remainingInvestment, "980.00");
  assert.equal(r.paybackMonths, "9.80");
  assert.equal(r.projectedRecoveryDate, "2027-08-03");
});
test("cancellation and void timestamps preserve earlier as-of reports", () => {
  const d = source();
  const s = sale("cancelled", "2026-10-01");
  s.status = "CANCELLED";
  s.cancelledAt = stamp("2026-10-08");
  s.payments = [];
  d.sales = [s];
  assert.equal(
    buildReport(d, {
      branchIds: ["DSO"],
      start: "2026-10-01",
      end: "2026-10-07",
    }).summary.revenue,
    "50.00",
  );
  assert.equal(
    buildReport(d, {
      branchIds: ["DSO"],
      start: "2026-10-01",
      end: "2026-10-08",
    }).summary.revenue,
    "0.00",
  );
});
test("CSV neutralizes spreadsheet injection while preserving numeric negative amounts", () => {
  const csv = csvExport({
    name: "Test",
    headers: ["Name", "Amount"],
    money: [1],
    rows: [
      ['=HYPERLINK("evil")', -10],
      ["@SUM(A1)", 1],
      [" +cmd", 2],
    ],
  });
  assert.ok(csv.includes("\"'=HYPERLINK"));
  assert.ok(csv.includes("\"'@SUM"));
  assert.ok(csv.includes('"-10"'));
  assert.ok(csv.includes('"\' +cmd"'));
});
test("Excel exports reconcile cached formulas and PDF is a valid multi-page financial report", async () => {
  const d = source();
  d.sales = [sale("one")];
  d.expenses = [expense("rent")];
  const report = buildReport(d, {
      branchIds: ["DSO"],
      start: "2026-10-01",
      end: "2026-10-08",
    }),
    datasets = exportDatasets(d, report);
  const bytes = await excelExport(datasets, report),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as any);
  const summary = book.getWorksheet("Profit and loss")!;
  assert.equal(
    (summary.getCell("B11").value as ExcelJS.CellFormulaValue).result,
    -45,
  );
  assert.equal(book.getWorksheet("Sales")!.getCell("G7").value, 50);
  assert.ok(book.getWorksheet("Sales")!.getCell("B7").value instanceof Date);
  assert.equal(book.getWorksheet("Sales")!.getCell("F7").value, "");
  const pdf = await PDFDocument.load(await pdfExport(datasets[0], report));
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "Protune Profit and loss");
});

test("forecast target status evaluates only configured targets", () => {
  const data = source();
  data.sales = [sale("target")];
  data.expenses = [expense("loss", "10000")];
  data.forecastConfigs = [
    { ...defaultForecast("DSO"), revenueTarget: "1", profitTarget: "0" },
  ];
  assert.equal(forecastBranch(data, "DSO", "2026-10-08").onTrack, true);
  data.forecastConfigs[0].profitTarget = "1";
  assert.equal(forecastBranch(data, "DSO", "2026-10-08").onTrack, false);
});
