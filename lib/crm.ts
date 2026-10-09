import { D, dubaiDate } from "./finance";
export function normalizeMobile(value: string) {
  let v = value.trim().replace(/[\s().-]/g, "");
  if (!v) return null;
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (/^05\d{8}$/.test(v)) v = "+971" + v.slice(1);
  if (/^971\d{9}$/.test(v)) v = "+" + v;
  if (!/^\+[1-9]\d{7,14}$/.test(v))
    throw new Error(
      "Use a UAE mobile (05xxxxxxxx) or an international number starting with +",
    );
  return v;
}
export function plateKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}
export function customerStats(
  sales: {
    createdAt: string | Date;
    status: string;
    total: string;
    net: string;
    payments: { amount: string }[];
  }[],
) {
  const valid = sales.filter((s) => s.status === "COMPLETED");
  return {
    visits: valid.length,
    net: valid.reduce((a, s) => a.plus(s.net), D(0)).toFixed(2),
    invoiced: valid.reduce((a, s) => a.plus(s.total), D(0)).toFixed(2),
    paid: valid
      .reduce(
        (a, s) =>
          a.plus(s.payments.reduce((sum, p) => sum.plus(p.amount), D(0))),
        D(0),
      )
      .toFixed(2),
    balance: valid
      .reduce(
        (a, s) =>
          a.plus(
            D(s.total).minus(
              s.payments.reduce((sum, p) => sum.plus(p.amount), D(0)),
            ),
          ),
        D(0),
      )
      .toFixed(2),
    lastVisit: valid.length
      ? valid
          .map((s) => dubaiDate(new Date(s.createdAt)))
          .sort()
          .at(-1)!
      : null,
  };
}
export function canMarket(
  customer: {
    active: boolean;
    marketingOptOut: boolean;
    consentEmail: boolean;
    consentWhatsApp: boolean;
    email: string;
    mobile: string;
  },
  channel: string,
) {
  return (
    customer.active &&
    !customer.marketingOptOut &&
    (channel === "EMAIL"
      ? customer.consentEmail && !!customer.email
      : channel === "WHATSAPP"
        ? customer.consentWhatsApp && !!customer.mobile
        : false)
  );
}

export function customerReportRows(
  customers: any[],
  start: string,
  end: string,
) {
  return customers.map((c) => {
    const sales = c.sales.filter(
        (s: any) =>
          dubaiDate(new Date(s.createdAt)) >= start &&
          dubaiDate(new Date(s.createdAt)) <= end,
      ),
      stats = customerStats(sales);
    return {
      ...c,
      ...stats,
      sales,
      sample: c.sample || sales.some((s: any) => s.sample),
    };
  });
}
