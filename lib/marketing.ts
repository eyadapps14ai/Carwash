import { D, round, dubaiDate, money } from "./finance";
export type VoucherRules = {
  branchIds: string[];
  serviceIds: string[];
  discountKind: string;
  discountValue: string;
  minimumSpend: string;
  campaignName: string;
};
export function voucherDiscount(
  rules: VoucherRules,
  branchId: string,
  lines: { serviceId: string; price: string }[],
) {
  if (!rules.branchIds.includes(branchId))
    throw new Error("Voucher is not valid at this branch");
  const subtotal = round(lines.reduce((sum, l) => sum.plus(l.price), D(0)));
  if (subtotal.lt(rules.minimumSpend))
    throw new Error("Minimum voucher spending has not been met");
  const eligible = lines.filter(
    (l) => !rules.serviceIds.length || rules.serviceIds.includes(l.serviceId),
  );
  if (!eligible.length)
    throw new Error("No eligible voucher service in this invoice");
  const base = round(eligible.reduce((sum, l) => sum.plus(l.price), D(0)));
  const off =
    rules.discountKind === "PERCENT"
      ? round(base.mul(rules.discountValue).div(100))
      : rules.discountKind === "FREE_SERVICE"
        ? D(
            eligible.reduce(
              (min, l) => (D(l.price).lt(min) ? l.price : min),
              eligible[0].price,
            ),
          )
        : D(rules.discountValue);
  return round(off.lt(base) ? off : base);
}
export function eligibleNet(
  s: { net: any; subtotal: any; lines: { serviceId: string; price: any }[] },
  ids: string[],
) {
  if (!ids.length) return D(s.net.toString());
  const base = s.lines
    .filter((l) => ids.includes(l.serviceId))
    .reduce((sum, l) => sum.plus(l.price.toString()), D(0));
  return D(s.subtotal.toString()).gt(0)
    ? round(D(s.net.toString()).mul(base).div(s.subtotal.toString()))
    : D(0);
}
export function offerText(r: VoucherRules) {
  return r.discountKind === "PERCENT"
    ? `${r.discountValue}% off eligible services`
    : r.discountKind === "FREE_SERVICE"
      ? "One eligible service free (lowest priced eligible service)"
      : `${money(r.discountValue)} off eligible services`;
}
export function renderMarketingMessage(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(
    /\{(name|code|expiry|offer|unsubscribe)\}/g,
    (_, key) => values[key] ?? "",
  );
}
export function fullyPaid(s: {
  status: string;
  total: any;
  payments: { amount: any }[];
}) {
  return (
    s.status === "COMPLETED" &&
    s.payments
      .reduce((sum, p) => sum.plus(p.amount.toString()), D(0))
      .gte(s.total.toString())
  );
}
export function voucherState(v: { status: string; expiresAt: string | Date }) {
  return v.status === "ISSUED" && new Date(v.expiresAt) <= new Date()
    ? "EXPIRED"
    : v.status;
}
export function inactiveDays(last: Date, now = new Date()) {
  return Math.floor(
    (Date.parse(dubaiDate(now)) - Date.parse(dubaiDate(last))) / 86400000,
  );
}
