import { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  FinanceData,
  ReportOptions,
  FinancialReport,
  buildReport,
  decimalSum,
} from "./intelligence";
import { Material } from "./operations";
import { Cost } from "./finance";
import { D } from "./finance";
export async function loadFinanceData(
  branchIds: string[],
  client: Prisma.TransactionClient = db,
): Promise<FinanceData> {
  const where = { branchId: { in: branchIds } };
  const [
    branches,
    sales,
    expenses,
    investments,
    cashMovements,
    forecastConfigs,
    services,
    periodCloses,
    stocks,
  ] = await Promise.all([
    client.branch.findMany({
      where: { id: { in: branchIds } },
      orderBy: { name: "asc" },
    }),
    client.sale.findMany({
      where,
      include: {
        lines: true,
        payments: true,
        workers: { select: { userId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    client.expense.findMany({
      where,
      include: { revisions: true },
      orderBy: { date: "desc" },
    }),
    client.investment.findMany({ where, orderBy: { date: "desc" } }),
    client.cashMovement.findMany({ where, orderBy: { date: "desc" } }),
    client.forecastConfig.findMany({ where }),
    client.service.findMany({
      include: { category: true, branches: { where } },
    }),
    client.periodClose.findMany({ where, orderBy: { month: "desc" } }),
    client.branchStock.findMany({ where }),
  ]);
  return JSON.parse(
    JSON.stringify({
      branches,
      sales,
      expenses,
      investments,
      cashMovements,
      forecastConfigs,
      services: services.map((s) => ({
        ...s,
        branches: s.branches.map((b) => {
          const materials = b.stockMaterials as Material[],
            excluded = new Set(materials.flatMap((m) => m.replaceCostNames));
          return {
            ...b,
            costs: [
              ...(b.costs as Cost[]).filter((c) => !excluded.has(c.name)),
              ...materials.map((m) => ({
                name: "Tracked inventory",
                mode: "QUANTITY",
                source: "INVENTORY",
                quantity: m.quantity,
                amount:
                  stocks
                    .find(
                      (x) => x.branchId === b.branchId && x.itemId === m.itemId,
                    )
                    ?.unitCost.toString() ?? "0",
              })),
            ],
          };
        }),
      })),
      periodCloses,
    }),
  );
}
export function reportWithSnapshots(
  data: FinanceData,
  options: ReportOptions,
): FinancialReport {
  const live = buildReport(data, options);
  if (
    live.filtered ||
    options.start.slice(-2) !== "01" ||
    options.end !==
      `${options.end.slice(0, 7)}-${String(new Date(Date.UTC(Number(options.end.slice(0, 4)), Number(options.end.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}` ||
    options.start.slice(0, 7) !== options.end.slice(0, 7)
  )
    return live;
  const parts = options.branchIds.map(
    (id) =>
      data.periodCloses.find(
        (c) => c.branchId === id && c.month === options.start.slice(0, 7),
      )?.snapshot ?? buildReport(data, { ...options, branchIds: [id] }, false),
  );
  const locked = data.periodCloses.filter(
    (c) =>
      options.branchIds.includes(c.branchId) &&
      c.month === options.start.slice(0, 7),
  );
  if (!locked.length) return live;
  const summary = { ...live.summary };
  for (const key of [
    "revenue",
    "serviceCosts",
    "contribution",
    "operatingExpenses",
    "otherExpenses",
    "taxExpenses",
    "operatingProfit",
    "netProfit",
    "vat",
    "receipts",
    "cashIn",
    "cashOut",
    "recordedCashFlow",
    "outstanding",
  ] as const)
    summary[key] = decimalSum(parts.map((p) => p.summary[key] ?? "0")).toFixed(
      2,
    );
  summary.vehicles = parts.reduce((n, p) => n + p.summary.vehicles, 0);
  summary.services = parts.reduce((n, p) => n + p.summary.services, 0);
  summary.margin = D(summary.revenue).gt(0)
    ? D(summary.netProfit ?? 0)
        .div(summary.revenue)
        .mul(100)
        .toFixed(2)
    : null;
  const serviceMap = new Map<string, FinancialReport["serviceRows"][number]>();
  parts
    .flatMap((p) => p.serviceRows)
    .forEach((r) => {
      const key = `${r.serviceId}|${r.name}|${r.category}`,
        old = serviceMap.get(key);
      if (!old) serviceMap.set(key, { ...r });
      else {
        old.count += r.count;
        for (const k of ["revenue", "cost", "contribution"] as const)
          old[k] = D(old[k]).plus(r[k]).toFixed(2);
        old.margin = D(old.revenue).gt(0)
          ? D(old.contribution).div(old.revenue).mul(100).toFixed(2)
          : null;
      }
    });
  return {
    ...live,
    closed: locked.length === options.branchIds.length,
    sample: parts.some((p) => p.sample),
    summary,
    saleRows: parts.flatMap((p) => p.saleRows),
    expenseRows: parts.flatMap((p) => p.expenseRows),
    cashRows: parts.flatMap((p) => p.cashRows),
    serviceRows: [...serviceMap.values()],
    dailyRows: live.dailyRows.map((day) => {
      const rows = parts.flatMap((p) =>
        p.dailyRows.filter((r) => r.date === day.date),
      );
      return {
        date: day.date,
        revenue: decimalSum(rows.map((r) => r.revenue)).toFixed(2),
        cost: decimalSum(rows.map((r) => r.cost)).toFixed(2),
        contribution: decimalSum(rows.map((r) => r.contribution)).toFixed(2),
        vehicles: rows.reduce((n, r) => n + r.vehicles, 0),
        services: rows.reduce((n, r) => n + r.services, 0),
      };
    }),
    branchRows: parts.map((p) => ({
      branchId: p.branches[0].id,
      name: p.branches[0].name,
      code: p.branches[0].code,
      summary: p.summary,
    })),
    notes: [
      ...live.notes,
      `Immutable closed snapshots used for ${locked.length} branch(es). Unclosed branches remain live.`,
    ],
  };
}
