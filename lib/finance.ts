import Decimal from "decimal.js";
export type Cost = {
  name: string;
  mode: "FIXED" | "PERCENT" | "QUANTITY";
  amount: string;
  quantity?: string;
  source?: "DIRECT" | "INVENTORY" | "PAYROLL";
};
export const D = (x: Decimal.Value) => new Decimal(x);
export const round = (x: Decimal.Value) =>
  D(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export function serviceCost(price: Decimal.Value, costs: Cost[]) {
  return round(
    costs.reduce((sum, c) => {
      // Salaried payroll is expensed separately; inventory components use consumption snapshots.
      if (c.source === "PAYROLL") return sum;
      const amount = D(c.amount);
      if (amount.isNegative()) throw new Error("Costs cannot be negative");
      return sum.plus(
        c.mode === "PERCENT"
          ? D(price).mul(amount).div(100)
          : c.mode === "QUANTITY"
            ? amount.mul(c.quantity ?? 1)
            : amount,
      );
    }, D(0)),
  );
}
export function saleTotals(
  lines: { price: Decimal.Value; cost: Decimal.Value }[],
  discount: Decimal.Value,
  vatRate: Decimal.Value,
) {
  const subtotal = round(lines.reduce((s, l) => s.plus(l.price), D(0)));
  const off = round(discount);
  if (off.isNegative() || off.gt(subtotal))
    throw new Error("Discount must be between zero and subtotal");
  const net = subtotal.minus(off),
    vat = round(net.mul(vatRate).div(100));
  return {
    subtotal,
    discount: off,
    net,
    vat,
    total: net.plus(vat),
    cost: round(lines.reduce((s, l) => s.plus(l.cost), D(0))),
  };
}
export function dubaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function period(date: string) {
  const [y, m] = date.split("-").map(Number);
  const start = new Date(
    `${y}-${String(m).padStart(2, "0")}-01T00:00:00+04:00`,
  );
  const end = new Date(Date.UTC(y, m, 1, -4));
  return { start, end, days: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}
export function expenseInMonth(
  e: { amount: Decimal.Value; date: Date; frequency: string; active: boolean },
  date: string,
) {
  if (!e.active) return D(0);
  const { start, end } = period(date);
  if (e.frequency === "ONCE")
    return e.date >= start && e.date < end ? D(e.amount) : D(0);
  if (e.date >= end) return D(0);
  return e.frequency === "ANNUAL" ? round(D(e.amount).div(12)) : D(e.amount);
}
export const money = (v: Decimal.Value) =>
  `AED ${D(v).toNumber().toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
