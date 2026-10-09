import { D, round, serviceCost, type Cost } from "./finance";
export const jobStatuses = [
  "NEW",
  "INSPECTION",
  "QUOTATION",
  "AWAITING_APPROVAL",
  "IN_PROGRESS",
  "AWAITING_PARTS",
  "COMPLETED",
  "DELIVERED",
  "CANCELLED",
] as const;
export const jobTransitions: Record<string, string[]> = {
  NEW: ["INSPECTION", "QUOTATION", "CANCELLED"],
  INSPECTION: ["QUOTATION", "CANCELLED"],
  QUOTATION: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["QUOTATION", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_PARTS", "COMPLETED", "CANCELLED"],
  AWAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};
export type Material = {
  itemId: string;
  quantity: string;
  replaceCostNames: string[];
};
export type JobLine = {
  serviceId: string;
  name: string;
  category: string;
  price: string;
  cost: string;
  costSnapshot: Cost[];
  materials: {
    itemId: string;
    name: string;
    quantity: string;
    unitCost: string;
  }[];
};
export function estimatedLineCost(
  price: string,
  costs: Cost[],
  materials: Material[],
  stock: { itemId: string; unitCost: string }[],
) {
  const replaced = new Set(materials.flatMap((m) => m.replaceCostNames));
  const base = serviceCost(
    price,
    costs.filter((c) => !replaced.has(c.name)),
  );
  return round(
    materials.reduce(
      (v, m) =>
        v.plus(
          D(m.quantity).mul(
            stock.find((s) => s.itemId === m.itemId)?.unitCost ?? 0,
          ),
        ),
      base,
    ),
  );
}
export function weightedStockCost(
  oldQty: string,
  oldCost: string,
  receivedQty: string,
  receivedCost: string,
) {
  const qty = D(oldQty).plus(receivedQty);
  if (qty.lte(0)) return D(0);
  return D(oldQty)
    .mul(oldCost)
    .plus(D(receivedQty).mul(receivedCost))
    .div(qty)
    .toDecimalPlaces(6);
}
export function hoursBetween(start: Date | string, end: Date | string) {
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 3600000,
  );
}
export function attributedRevenue(net: string, workers: string[]) {
  const ids = [...new Set(workers)].sort();
  if (!ids.length) return {};
  const cents = D(net).mul(100).round().toNumber(),
    base = Math.floor(cents / ids.length),
    extra = cents % ids.length;
  return Object.fromEntries(
    ids.map((id, i) => [
      id,
      D(base + (i < extra ? 1 : 0))
        .div(100)
        .toFixed(2),
    ]),
  );
}
export function inventoryUsage(
  movements: {
    branchId: string;
    itemId: string;
    quantity: string;
    value: string;
    kind: string;
    item: { name: string; sku: string; unit: string };
  }[],
) {
  const rows = new Map<
    string,
    {
      branchId: string;
      itemId: string;
      name: string;
      sku: string;
      unit: string;
      quantity: string;
      cost: string;
    }
  >();
  for (const m of movements) {
    if (m.kind !== "CONSUMPTION") continue;
    const key = m.branchId + ":" + m.itemId,
      old = rows.get(key);
    rows.set(key, {
      branchId: m.branchId,
      itemId: m.itemId,
      ...m.item,
      quantity: D(old?.quantity ?? 0)
        .minus(m.quantity)
        .toFixed(4),
      cost: D(old?.cost ?? 0)
        .minus(m.value)
        .toFixed(2),
    });
  }
  return [...rows.values()];
}
