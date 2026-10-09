import Decimal from "decimal.js";
import {
  D,
  round,
  dubaiDate,
  period,
  expenseInMonth,
  serviceCost,
  Cost,
} from "./finance";
export type Value = string;
export interface BranchRecord {
  id: string;
  name: string;
  code: string;
  active: boolean;
}
export interface LineRecord {
  id: string;
  serviceId: string;
  name: string;
  category: string;
  price: Value;
  cost: Value;
}
export interface PaymentRecord {
  id: string;
  amount: Value;
  method: string;
  createdAt: string;
}
export interface SaleRecord {
  id: string;
  number: string;
  branchId: string;
  createdAt: string;
  cancelledAt?: string | null;
  status: string;
  plate: string;
  net: Value;
  subtotal: Value;
  total: Value;
  vat: Value;
  discount: Value;
  cost: Value;
  sample: boolean;
  lines: LineRecord[];
  payments: PaymentRecord[];
  workers: { userId: string }[];
}
export interface ExpenseVersion {
  id?: number;
  effectiveMonth?: string;
  category: string;
  description: string;
  amount: Value;
  date: string;
  frequency: string;
  kind: string;
  active: boolean;
}
export interface ExpenseRecord extends ExpenseVersion {
  id: any;
  branchId: string;
  sample: boolean;
  revisions?: ExpenseVersion[];
}
export interface InvestmentRecord {
  id: string;
  branchId: string;
  category: string;
  description: string;
  amount: Value;
  date: string;
  kind: string;
  sample: boolean;
}
export interface CashRecord {
  id: string;
  branchId: string;
  investmentId?: string | null;
  expenseId?: string | null;
  amount: Value;
  date: string;
  direction: string;
  category: string;
  description: string;
  voidedAt?: string | null;
  sample: boolean;
}
export interface ForecastSettings {
  branchId: string;
  basis: string;
  conservativePct: Value;
  expectedPct: Value;
  optimisticPct: Value;
  futureCostPct: Value;
  extraExpense: Value;
  revenueTarget: Value;
  profitTarget: Value;
  recoveryMonthlyCash: Value;
  cashReviewedThrough: string;
}
export interface CatalogRecord {
  id: string;
  name: string;
  active: boolean;
  category: { name: string; active: boolean };
  branches: {
    id: string;
    branchId: string;
    price: Value;
    costs: Cost[];
    active: boolean;
  }[];
}
export interface FinanceData {
  branches: BranchRecord[];
  sales: SaleRecord[];
  expenses: ExpenseRecord[];
  investments: InvestmentRecord[];
  cashMovements: CashRecord[];
  forecastConfigs: ForecastSettings[];
  services: CatalogRecord[];
  periodCloses: {
    id: string;
    branchId: string;
    month: string;
    createdAt: string;
    snapshot: FinancialReport;
  }[];
}
export const defaultForecast = (branchId: string): ForecastSettings => ({
  branchId,
  basis: "AUTO",
  conservativePct: "85",
  expectedPct: "100",
  optimisticPct: "115",
  futureCostPct: "100",
  extraExpense: "0",
  revenueTarget: "0",
  profitTarget: "0",
  recoveryMonthlyCash: "0",
  cashReviewedThrough: "",
});
export const decimalSum = (values: (string | number)[]) =>
  values.reduce<ReturnType<typeof D>>((sum, value) => sum.plus(value), D(0));
const val = (value: ReturnType<typeof D>) => round(value).toFixed(2);
const pct = (n: ReturnType<typeof D>, d: ReturnType<typeof D>) =>
  d.gt(0) ? n.div(d).mul(100).toFixed(2) : null;
export const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
export const monthEnd = (month: string) =>
  `${month.slice(0, 7)}-${String(period(month.slice(0, 7)).days).padStart(2, "0")}`;
export function dayUTC(day: string) {
  return new Date(`${day}T00:00:00Z`);
}
export function addDays(day: string, count: number) {
  const d = dayUTC(day);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function dates(start: string, end: string) {
  const result: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    result.push(d);
    if (result.length > 366)
      throw new Error("Report range must be at most 366 days");
  }
  return result;
}
export const dateOnly = (input: string) => dubaiDate(new Date(input));
const endInstant = (day: string) => new Date(`${day}T23:59:59.999+04:00`);
export function saleAt(s: SaleRecord, end: string) {
  return (
    dateOnly(s.createdAt) <= end &&
    (s.status === "COMPLETED" ||
      (s.status === "CANCELLED" &&
        !!s.cancelledAt &&
        new Date(s.cancelledAt) > endInstant(end)))
  );
}
export function cashAt(c: CashRecord, end: string) {
  return (
    dateOnly(c.date) <= end &&
    (!c.voidedAt || new Date(c.voidedAt) > endInstant(end))
  );
}
export function resolveExpense(
  e: ExpenseRecord,
  month: string,
): ExpenseVersion | null {
  if (!e.revisions?.length) return e;
  return (
    e.revisions
      .filter(
        (r) => (r.effectiveMonth ?? dateOnly(r.date).slice(0, 7)) <= month,
      )
      .sort(
        (a, b) =>
          (b.effectiveMonth ?? "").localeCompare(a.effectiveMonth ?? "") ||
          Number(b.id) - Number(a.id),
      )[0] ?? null
  );
}
export function expenseMonth(e: ExpenseRecord, month: string) {
  const r = resolveExpense(e, month);
  return r ? expenseInMonth({ ...r, date: new Date(r.date) }, month) : D(0);
}
export function expenseBetween(
  e: ExpenseRecord,
  month: string,
  start: string,
  end: string,
) {
  const r = resolveExpense(e, month);
  if (!r?.active) return D(0);
  const budget = expenseMonth(e, month);
  if (r.frequency === "ONCE")
    return dateOnly(r.date) >= start && dateOnly(r.date) <= end ? budget : D(0);
  const first = Math.max(
      1,
      Number(start.slice(0, 7) === month ? start.slice(-2) : 1),
    ),
    last = Math.min(
      period(month).days,
      Number(end.slice(0, 7) === month ? end.slice(-2) : period(month).days),
    );
  if (last < first) return D(0);
  // Prefix differences keep daily and partial-period allocations exactly reconciled to the monthly budget.
  return round(budget.mul(last).div(period(month).days)).minus(
    round(budget.mul(first - 1).div(period(month).days)),
  );
}
/** Largest-remainder allocation preserves invoice cents even with many lines and near-total discounts. */
export function allocateNet(s: Pick<SaleRecord, "net" | "subtotal" | "lines">) {
  if (D(s.subtotal).eq(0)) return s.lines.map(() => D(0));
  const cents = D(s.net).mul(100),
    raw = s.lines.map((l) => cents.mul(l.price).div(s.subtotal)),
    allocated = raw.map((v) => v.floor());
  let remaining = cents
    .minus(allocated.reduce((a, b) => a.plus(b), D(0)))
    .toNumber();
  const order = raw
    .map((v, i) => ({ i, fraction: v.minus(allocated[i]) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.i - b.i);
  for (let i = 0; i < remaining; i++)
    allocated[order[i].i] = allocated[order[i].i].plus(1);
  return allocated.map((v) => v.div(100));
}
export interface ReportOptions {
  start: string;
  end: string;
  branchIds: string[];
  serviceId?: string;
  category?: string;
  employeeId?: string;
  method?: string;
}
export interface ReportSummary {
  revenue: string;
  serviceCosts: string;
  contribution: string;
  operatingExpenses: string;
  otherExpenses: string;
  taxExpenses: string;
  operatingProfit: string | null;
  netProfit: string | null;
  margin: string | null;
  vehicles: number;
  services: number;
  vat: string;
  receipts: string;
  cashIn: string;
  cashOut: string;
  recordedCashFlow: string | null;
  outstanding: string;
}
export interface FinancialReport {
  start: string;
  end: string;
  branches: { id: string; name: string; code: string }[];
  sample: boolean;
  filtered: boolean;
  notes: string[];
  closed: boolean;
  summary: ReportSummary;
  serviceRows: {
    serviceId: string;
    name: string;
    category: string;
    count: number;
    revenue: string;
    cost: string;
    contribution: string;
    margin: string | null;
  }[];
  expenseRows: {
    id: string;
    branchId: string;
    category: string;
    description: string;
    month: string;
    kind: string;
    amount: string;
    sample: boolean;
  }[];
  saleRows: {
    id: string;
    number: string;
    date: string;
    branchId: string;
    plate: string;
    services: string;
    net: string;
    invoiceNet: string;
    vat: string;
    total: string;
    paid: string;
    outstanding: string;
    cost: string;
    contribution: string;
    sample: boolean;
  }[];
  dailyRows: {
    date: string;
    revenue: string;
    cost: string;
    contribution: string;
    vehicles: number;
    services: number;
  }[];
  branchRows: {
    branchId: string;
    name: string;
    code: string;
    summary: ReportSummary;
  }[];
  cashRows: {
    id: string;
    date: string;
    branchId: string;
    direction: string;
    category: string;
    description: string;
    amount: string;
    sample: boolean;
  }[];
}
export function buildReport(
  data: FinanceData,
  o: ReportOptions,
  includeBranches = true,
): FinancialReport {
  const days = dates(o.start, o.end),
    monthList = [...new Set(days.map((d) => d.slice(0, 7)))],
    branchSet = new Set(o.branchIds);
  const filtered = !!(o.serviceId || o.category || o.employeeId || o.method);
  const lineMatches = (l: LineRecord) =>
    (!o.serviceId || l.serviceId === o.serviceId) &&
    (!o.category || l.category === o.category);
  const eligible = data.sales.filter(
    (s) =>
      branchSet.has(s.branchId) &&
      saleAt(s, o.end) &&
      (!o.employeeId || s.workers.some((w) => w.userId === o.employeeId)) &&
      (!o.method ||
        s.payments.some(
          (p) => p.method === o.method && dateOnly(p.createdAt) <= o.end,
        )) &&
      s.lines.some(lineMatches),
  );
  const selected = eligible.filter((s) => dateOnly(s.createdAt) >= o.start);
  const serviceMap = new Map<string, FinancialReport["serviceRows"][number]>(),
    dailyMap = new Map(
      days.map((date) => [
        date,
        {
          date,
          revenue: "0.00",
          cost: "0.00",
          contribution: "0.00",
          vehicles: 0,
          services: 0,
        },
      ]),
    );
  const saleRows = selected.map((s) => {
    const allocations = allocateNet(s);
    let net = D(0),
      cost = D(0),
      count = 0;
    s.lines.forEach((l, i) => {
      if (!lineMatches(l)) return;
      net = net.plus(allocations[i]);
      cost = cost.plus(l.cost);
      if (!l.serviceId.startsWith("inventory:")) count++;
      const key = `${l.serviceId}|${l.name}|${l.category}`;
      const r = serviceMap.get(key) ?? {
        serviceId: l.serviceId,
        name: l.name,
        category: l.category,
        count: 0,
        revenue: "0",
        cost: "0",
        contribution: "0",
        margin: null,
      };
      r.count++;
      r.revenue = val(D(r.revenue).plus(allocations[i]));
      r.cost = val(D(r.cost).plus(l.cost));
      r.contribution = val(D(r.revenue).minus(r.cost));
      r.margin = pct(D(r.contribution), D(r.revenue));
      serviceMap.set(key, r);
    });
    const paid = decimalSum(
        s.payments
          .filter((p) => dateOnly(p.createdAt) <= o.end)
          .map((p) => p.amount),
      ),
      day = dateOnly(s.createdAt),
      daily = dailyMap.get(day)!;
    daily.revenue = val(D(daily.revenue).plus(net));
    daily.cost = val(D(daily.cost).plus(cost));
    daily.contribution = val(D(daily.revenue).minus(daily.cost));
    daily.vehicles++;
    daily.services += count;
    return {
      id: s.id,
      number: s.number,
      date: day,
      branchId: s.branchId,
      plate: s.plate,
      services: s.lines
        .filter(lineMatches)
        .map((l) => l.name)
        .join("; "),
      net: val(net),
      invoiceNet: s.net,
      vat: s.vat,
      total: s.total,
      paid: val(paid),
      outstanding: val(D(s.total).minus(paid)),
      cost: val(cost),
      contribution: val(net.minus(cost)),
      sample: s.sample,
    };
  });
  const expenseRows: FinancialReport["expenseRows"] = [];
  data.expenses
    .filter((e) => branchSet.has(e.branchId))
    .forEach((e) =>
      monthList.forEach((month) => {
        const r = resolveExpense(e, month);
        const amount = expenseBetween(e, month, o.start, o.end);
        if (r && amount.gt(0))
          expenseRows.push({
            id: e.id,
            branchId: e.branchId,
            category: r.category,
            description: r.description,
            month,
            kind: r.kind,
            amount: val(amount),
            sample: e.sample,
          });
      }),
    );
  const customerReceipts = eligible.flatMap((s) =>
    s.payments
      .filter(
        (p) =>
          dateOnly(p.createdAt) >= o.start && dateOnly(p.createdAt) <= o.end,
      )
      .map((p) => ({
        id: p.id,
        date: dateOnly(p.createdAt),
        branchId: s.branchId,
        direction: "IN",
        category: "CUSTOMER_PAYMENT",
        description: `Invoice ${s.number} / ${p.method}`,
        amount: p.amount,
        sample: s.sample,
      })),
  );
  const cashRows = [
    ...customerReceipts,
    ...data.cashMovements
      .filter(
        (c) =>
          branchSet.has(c.branchId) &&
          cashAt(c, o.end) &&
          dateOnly(c.date) >= o.start,
      )
      .map((c) => ({
        id: c.id,
        date: dateOnly(c.date),
        branchId: c.branchId,
        direction: c.direction,
        category: c.category,
        description: c.description,
        amount: c.amount,
        sample: c.sample,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const revenue = decimalSum(saleRows.map((s) => s.net)),
    cost = decimalSum(saleRows.map((s) => s.cost)),
    opex = decimalSum(
      expenseRows
        .filter((e) => ["FIXED", "VARIABLE"].includes(e.kind))
        .map((e) => e.amount),
    ),
    other = decimalSum(
      expenseRows.filter((e) => e.kind === "OTHER").map((e) => e.amount),
    ),
    tax = decimalSum(
      expenseRows.filter((e) => e.kind === "TAX").map((e) => e.amount),
    ),
    contribution = revenue.minus(cost),
    op = contribution.minus(opex),
    net = op.minus(other).minus(tax),
    cashIn = decimalSum(
      cashRows.filter((c) => c.direction === "IN").map((c) => c.amount),
    ),
    cashOut = decimalSum(
      cashRows.filter((c) => c.direction === "OUT").map((c) => c.amount),
    );
  const outstanding = eligible.reduce(
    (a, s) =>
      a.plus(
        D(s.total).minus(
          decimalSum(
            s.payments
              .filter((p) => dateOnly(p.createdAt) <= o.end)
              .map((p) => p.amount),
          ),
        ),
      ),
    D(0),
  );
  const notes = [
    "Revenue excludes VAT. Invoice balances and customer cash receipts include VAT.",
    "Service costs are historical estimates. Recurring expenses are allocated accruals, not evidence of payment.",
    "Cash flow includes recorded customer payments and cash journal entries only. It is not a bank balance.",
    ...(filtered
      ? [
          "Sales filters show selected service contribution; branch overhead is not allocated, so operating/net profit and company cash flow are unavailable. Employee filters select shared invoices once.",
        ]
      : []),
    "Taxes and non-operating expenses use recorded entries; no statutory income tax is calculated.",
  ];
  return {
    start: o.start,
    end: o.end,
    branches: data.branches
      .filter((b) => branchSet.has(b.id))
      .map(({ id, name, code }) => ({ id, name, code })),
    sample:
      selected.some((s) => s.sample) ||
      expenseRows.some((e) => e.sample) ||
      cashRows.some((c) => c.sample),
    filtered,
    notes,
    closed: false,
    summary: {
      revenue: val(revenue),
      serviceCosts: val(cost),
      contribution: val(contribution),
      operatingExpenses: val(opex),
      otherExpenses: val(other),
      taxExpenses: val(tax),
      operatingProfit: filtered ? null : val(op),
      netProfit: filtered ? null : val(net),
      margin: filtered ? null : pct(net, revenue),
      vehicles: saleRows.length,
      services: [...serviceMap.values()]
        .filter((s) => !s.serviceId.startsWith("inventory:"))
        .reduce((n, s) => n + s.count, 0),
      vat: val(decimalSum(saleRows.map((s) => s.vat))),
      receipts: val(decimalSum(customerReceipts.map((c) => c.amount))),
      cashIn: val(cashIn),
      cashOut: val(cashOut),
      recordedCashFlow: filtered ? null : val(cashIn.minus(cashOut)),
      outstanding: val(outstanding),
    },
    serviceRows: [...serviceMap.values()].sort((a, b) =>
      D(b.contribution).comparedTo(a.contribution),
    ),
    expenseRows,
    saleRows,
    dailyRows: [...dailyMap.values()],
    branchRows: includeBranches
      ? data.branches
          .filter((b) => branchSet.has(b.id))
          .map((b) => ({
            branchId: b.id,
            name: b.name,
            code: b.code,
            summary: buildReport(data, { ...o, branchIds: [b.id] }, false)
              .summary,
          }))
      : [],
    cashRows,
  };
}
export function catalogMix(data: FinanceData, branchIds: string[]) {
  return data.services
    .filter((s) => s.active && s.category.active)
    .flatMap((s) =>
      s.branches
        .filter((b) => b.active && branchIds.includes(b.branchId))
        .map((b) => ({
          id: b.id,
          branchId: b.branchId,
          name: s.name,
          price: b.price,
          cost: serviceCost(b.price, b.costs).toFixed(2),
          weight: 1,
        })),
    );
}
export function forecastBranch(
  data: FinanceData,
  branchId: string,
  asOf: string,
  override?: Partial<ForecastSettings>,
) {
  const month = asOf.slice(0, 7),
    monthDays = period(month).days,
    elapsed = Number(asOf.slice(-2)),
    remaining = monthDays - elapsed,
    cfg = {
      ...defaultForecast(branchId),
      ...data.forecastConfigs.find((c) => c.branchId === branchId),
      ...override,
    },
    actual = buildReport(
      data,
      { start: monthStart(month), end: asOf, branchIds: [branchId] },
      false,
    ).summary;
  const allSales = data.sales.filter(
      (s) => s.branchId === branchId && saleAt(s, asOf),
    ),
    history = allSales.filter((s) => dateOnly(s.createdAt) < monthStart(month));
  const first = history.length
      ? history.map((s) => dateOnly(s.createdAt)).sort()[0]
      : monthStart(month),
    historyStart =
      first > addDays(monthStart(month), -90)
        ? first
        : addDays(monthStart(month), -90),
    historyEnd = addDays(monthStart(month), -1);
  const historyDays =
    historyStart <= historyEnd ? dates(historyStart, historyEnd) : [];
  const usePattern = cfg.basis === "AUTO" && historyDays.length >= 28;
  const historic = history.filter((s) => dateOnly(s.createdAt) >= historyStart),
    training = actual.services
      ? allSales.filter((s) => dateOnly(s.createdAt) >= monthStart(month))
      : historic;
  const trainingRevenue = decimalSum(training.map((s) => s.net)),
    trainingCost = decimalSum(training.map((s) => s.cost)),
    trainingCount = training.reduce((n, s) => n + s.lines.length, 0),
    mix = catalogMix(data, [branchId]);
  const averageService = trainingCount
    ? trainingRevenue.div(trainingCount)
    : mix.length
      ? decimalSum(mix.map((m) => m.price)).div(mix.length)
      : D(0);
  const costRatio = trainingRevenue.gt(0)
    ? trainingCost.div(trainingRevenue)
    : mix.length && averageService.gt(0)
      ? decimalSum(mix.map((m) => m.cost))
          .div(mix.length)
          .div(averageService)
      : D(0);
  const averageDay = D(actual.revenue).div(elapsed);
  let baseline = D(0);
  if (usePattern) {
    const averages = Array.from({ length: 7 }, (_, weekday) => {
      const ds = historyDays.filter((d) => dayUTC(d).getUTCDay() === weekday),
        dsSet = new Set(ds);
      return ds.length
        ? decimalSum(
            historic
              .filter((s) => dsSet.has(dateOnly(s.createdAt)))
              .map((s) => s.net),
          ).div(ds.length)
        : D(0);
    });
    for (const d of remaining ? dates(addDays(asOf, 1), monthEnd(month)) : [])
      baseline = baseline.plus(averages[dayUTC(d).getUTCDay()]);
  } else baseline = averageDay.mul(remaining);
  const full = buildReport(
    data,
    { start: monthStart(month), end: monthEnd(month), branchIds: [branchId] },
    false,
  ).summary;
  const scenarios = (
    [
      ["Conservative", cfg.conservativePct],
      ["Expected", cfg.expectedPct],
      ["Optimistic", cfg.optimisticPct],
    ] as const
  ).map(([name, multiplier]) => {
    const futureRevenue = round(baseline.mul(multiplier).div(100)),
      revenue = D(actual.revenue).plus(futureRevenue),
      cost = D(actual.serviceCosts).plus(
        round(futureRevenue.mul(costRatio).mul(cfg.futureCostPct).div(100)),
      ),
      opExpenses = D(full.operatingExpenses).plus(
        remaining ? D(cfg.extraExpense) : 0,
      ),
      totalExpenses = cost
        .plus(opExpenses)
        .plus(full.otherExpenses)
        .plus(full.taxExpenses),
      operatingProfit = revenue.minus(cost).minus(opExpenses),
      netProfit = revenue.minus(totalExpenses);
    return {
      name,
      multiplier,
      remainingRevenue: val(futureRevenue),
      revenue: val(revenue),
      serviceCosts: val(cost),
      operatingExpenses: val(opExpenses),
      totalExpenses: val(totalExpenses),
      operatingProfit: val(operatingProfit),
      netProfit: val(netProfit),
      margin: pct(netProfit, revenue),
    };
  });
  const expected = scenarios[1],
    needed = Decimal.max(0, D(cfg.revenueTarget).minus(actual.revenue)),
    gap = Decimal.max(0, D(cfg.revenueTarget).minus(expected.revenue));
  return {
    branchId,
    cfg,
    actual,
    scenarios,
    elapsed,
    remaining,
    averageDailyRevenue: val(averageDay),
    averageServicePrice: val(averageService),
    method: usePattern
      ? `Weekday averages from ${historyDays.length} prior calendar days (zero-sale days included)`
      : "Month-to-date daily average (zero-sale days included)",
    baselineRemainingRevenue: val(baseline),
    neededRevenue: val(needed),
    requiredDailyRevenue: remaining ? val(needed.div(remaining)) : null,
    requiredDailyServices:
      remaining && averageService.gt(0)
        ? needed.div(remaining).div(averageService).ceil().toNumber()
        : null,
    additionalDailyServices:
      remaining && averageService.gt(0)
        ? gap.div(remaining).div(averageService).ceil().toNumber()
        : null,
    onTrack:
      D(cfg.revenueTarget).gt(0) || D(cfg.profitTarget).gt(0)
        ? (D(cfg.revenueTarget).lte(0) ||
            D(expected.revenue).gte(cfg.revenueTarget)) &&
          (D(cfg.profitTarget).lte(0) ||
            D(expected.operatingProfit).gte(cfg.profitTarget))
        : null,
  };
}
export function forecastCompany(
  data: FinanceData,
  branchIds: string[],
  asOf: string,
) {
  const branches = branchIds.map((id) => forecastBranch(data, id, asOf)),
    scenarios = ["Conservative", "Expected", "Optimistic"].map((name, i) => {
      const selected = branches.map((b) => b.scenarios[i]);
      const sum = (
        key:
          | "revenue"
          | "serviceCosts"
          | "operatingExpenses"
          | "totalExpenses"
          | "operatingProfit"
          | "netProfit"
          | "remainingRevenue",
      ) => val(decimalSum(selected.map((s) => s[key])));
      return {
        name,
        revenue: sum("revenue"),
        serviceCosts: sum("serviceCosts"),
        operatingExpenses: sum("operatingExpenses"),
        totalExpenses: sum("totalExpenses"),
        operatingProfit: sum("operatingProfit"),
        netProfit: sum("netProfit"),
        remainingRevenue: sum("remainingRevenue"),
        margin: pct(
          decimalSum(selected.map((s) => s.netProfit)),
          decimalSum(selected.map((s) => s.revenue)),
        ),
      };
    });
  return { branches, scenarios };
}
export interface MixItem {
  price: string;
  cost: string;
  weight: number;
}
export function breakEven(
  fixed: string,
  items: MixItem[],
  days: number,
  variableOverheadPct = "0",
) {
  const weight = items.reduce((n, i) => n + i.weight, 0);
  if (!weight || days <= 0) return null;
  const averagePrice = items
      .reduce((n, i) => n.plus(D(i.price).mul(i.weight)), D(0))
      .div(weight),
    averageCost = items
      .reduce((n, i) => n.plus(D(i.cost).mul(i.weight)), D(0))
      .div(weight),
    overhead = averagePrice.mul(variableOverheadPct).div(100),
    contribution = averagePrice.minus(averageCost).minus(overhead);
  if (contribution.lte(0) || averagePrice.lte(0))
    return {
      viable: false,
      averagePrice: val(averagePrice),
      averageCost: val(averageCost),
      contribution: val(contribution),
      rawContribution: contribution.toFixed(8),
      margin: null,
      monthlyRevenue: null,
      monthlyServices: null,
      dailyServices: null,
      dailyRevenue: null,
    };
  const services = D(fixed).div(contribution).ceil(),
    revenue = D(fixed).div(contribution.div(averagePrice));
  return {
    viable: true,
    averagePrice: val(averagePrice),
    averageCost: val(averageCost),
    contribution: val(contribution),
    rawContribution: contribution.toFixed(8),
    margin: pct(contribution, averagePrice),
    monthlyRevenue: val(revenue),
    monthlyServices: services.toNumber(),
    dailyServices: services.div(days).ceil().toNumber(),
    dailyRevenue: val(revenue.div(days)),
  };
}
export function investmentROI(
  data: FinanceData,
  branchId: string,
  asOf: string,
) {
  const investments = data.investments.filter(
      (i) => i.branchId === branchId && dateOnly(i.date) <= asOf,
    ),
    capital = investments.filter((i) => i.kind === "CAPITAL"),
    deposits = investments.filter((i) => i.kind === "DEPOSIT"),
    movements = data.cashMovements.filter(
      (c) => c.branchId === branchId && cashAt(c, asOf),
    ),
    first = capital.length
      ? capital.map((i) => dateOnly(i.date)).sort()[0]
      : monthStart(asOf),
    cfg = {
      ...defaultForecast(branchId),
      ...data.forecastConfigs.find((c) => c.branchId === branchId),
    };
  const cashNet = (category: string, direction: string) =>
    decimalSum(
      movements
        .filter((c) => c.category === category && c.direction === direction)
        .map((c) => c.amount),
    );
  const capitalAmount = decimalSum(capital.map((i) => i.amount)),
    capitalPaid = cashNet("CAPITAL", "OUT"),
    capitalReturned = cashNet("CAPITAL", "IN"),
    depositAmount = decimalSum(deposits.map((i) => i.amount)),
    depositPaid = cashNet("DEPOSIT", "OUT"),
    depositReturned = cashNet("DEPOSIT", "IN");
  // Compute cumulatives by monthly chunks; no arbitrary multi-year truncation.
  let operatingCash = D(0),
    allCash = D(0),
    cumulativeProfit = D(0),
    cursor = first;
  while (cursor <= asOf) {
    const end = monthEnd(cursor) < asOf ? monthEnd(cursor) : asOf,
      report = buildReport(
        data,
        { branchIds: [branchId], start: cursor, end },
        false,
      );
    operatingCash = operatingCash.plus(
      report.cashRows
        .filter((c) =>
          ["CUSTOMER_PAYMENT", "OPERATING", "TAX", "OTHER"].includes(
            c.category,
          ),
        )
        .reduce(
          (n, c) =>
            c.direction === "IN" ? n.plus(c.amount) : n.minus(c.amount),
          D(0),
        ),
    );
    allCash = allCash.plus(report.summary.recordedCashFlow ?? 0);
    cumulativeProfit = cumulativeProfit.plus(
      report.summary.operatingProfit ?? 0,
    );
    cursor = addDays(end, 1);
  }
  const month = buildReport(
      data,
      { branchIds: [branchId], start: monthStart(asOf), end: asOf },
      false,
    ).summary,
    remaining = Decimal.max(
      0,
      capitalAmount.minus(capitalReturned).minus(Decimal.max(0, operatingCash)),
    ),
    reviewed = cfg.cashReviewedThrough >= asOf,
    recovery = D(cfg.recoveryMonthlyCash),
    months =
      reviewed && capitalAmount.gt(0) && recovery.gt(0)
        ? remaining.div(recovery).toDecimalPlaces(2, 1)
        : null,
    projectedDate =
      months && remaining.div(recovery).mul("30.4375").lte(365250)
        ? addDays(
            asOf,
            remaining.div(recovery).mul("30.4375").ceil().toNumber(),
          )
        : null;
  return {
    branchId,
    capitalAmount: val(capitalAmount),
    capitalPaid: val(capitalPaid),
    capitalReturned: val(capitalReturned),
    depositAmount: val(depositAmount),
    depositHeld: val(depositPaid.minus(depositReturned)),
    monthlyOperatingProfit: month.operatingProfit,
    monthlyOperatingReturn: pct(D(month.operatingProfit ?? 0), capitalAmount),
    cumulativeOperatingProfit: val(cumulativeProfit),
    cumulativeOperatingCash: val(operatingCash),
    cumulativeCashFlow: val(allCash),
    remainingInvestment: reviewed ? val(remaining) : null,
    paybackMonths: months?.toFixed(2) ?? null,
    projectedRecoveryDate: projectedDate,
    cashReviewedThrough: cfg.cashReviewedThrough,
    reviewed,
    recoveryMonthlyCash: cfg.recoveryMonthlyCash,
  };
}
