import { db } from "./db";
import { providerReadiness } from "./marketing-delivery";
import { fullyPaid, eligibleNet } from "./marketing";
import { D, dubaiDate } from "./finance";
export async function loadMarketingData(
  u: { role: string; branches: { branchId: string }[] },
  branchIds: string[],
  start = dubaiDate().slice(0, 7) + "-01",
  end = dubaiDate(),
) {
  if (u.role === "TECHNICIAN") return null;
  const inRange = (date: Date | string | null | undefined) =>
    !!date &&
    dubaiDate(new Date(date)) >= start &&
    dubaiDate(new Date(date)) <= end;
  const manager = ["OWNER", "MANAGER"].includes(u.role),
    ids = new Set(branchIds);
  const campaigns = (
    await db.campaign.findMany({ orderBy: { createdAt: "desc" } })
  ).filter((c) => (c.branchIds as string[]).some((id) => ids.has(id)));
  const vouchers = await db.voucher.findMany({
    where: {
      OR: [
        { branchId: { in: branchIds } },
        { redemption: { sale: { branchId: { in: branchIds } } } },
      ],
    },
    include: {
      customer: { select: { name: true } },
      redemption: { include: { sale: { include: { payments: true } } } },
      delivery: manager
        ? {
            select: {
              id: true,
              channel: true,
              status: true,
              reason: true,
              attempts: true,
              createdAt: true,
              acceptedAt: true,
              deliveredAt: true,
            },
          }
        : false,
    },
    orderBy: { issuedAt: "desc" },
  });
  const safeVouchers = vouchers
    .filter(
      (v) =>
        inRange(v.issuedAt) ||
        (v.redemption && inRange(v.redemption.createdAt)),
    )
    .map((v) => ({
      ...v,
      redemption:
        v.redemption && ids.has(v.redemption.sale.branchId)
          ? {
              saleId: v.redemption.saleId,
              number: v.redemption.sale.number,
              branchId: v.redemption.sale.branchId,
              discount: v.redemption.discount,
              voidedAt: v.redemption.voidedAt,
              createdAt: v.redemption.createdAt,
              ...(manager
                ? { net: v.redemption.sale.net, cost: v.redemption.sale.cost }
                : {}),
            }
          : null,
    }));
  const customers = manager
    ? await db.customer.findMany({
        where: { branches: { some: { branchId: { in: branchIds } } } },
        select: {
          id: true,
          name: true,
          sales: {
            where: { branchId: { in: branchIds }, status: "COMPLETED" },
            include: { payments: true, lines: true },
          },
        },
      })
    : [];
  const progress = campaigns
    .filter((c) => ["LOYALTY_VISITS", "LOYALTY_SPEND"].includes(c.kind))
    .flatMap((c) =>
      customers.flatMap((customer) => {
        const eligible = customer.sales.filter(
          (s) =>
            fullyPaid(s) &&
            (c.branchIds as string[]).includes(s.branchId) &&
            dubaiDate(s.createdAt) >= c.startDate &&
            dubaiDate(s.createdAt) <= c.endDate &&
            s.lines.some(
              (l) =>
                !(c.serviceIds as string[]).length ||
                (c.serviceIds as string[]).includes(l.serviceId),
            ),
        );
        if (
          !eligible.length &&
          !vouchers.some(
            (v) => v.campaignId === c.id && v.customerId === customer.id,
          )
        )
          return [];
        const value =
          c.kind === "LOYALTY_VISITS"
            ? D(eligible.length)
            : eligible.reduce(
                (sum, s) => sum.plus(eligibleNet(s, c.serviceIds as string[])),
                D(0),
              );
        return [
          {
            customerId: customer.id,
            customerName: customer.name,
            campaignId: c.id,
            kind: c.kind,
            value: value.toFixed(2),
            threshold: c.threshold.toString(),
            issued: vouchers.filter(
              (v) => v.campaignId === c.id && v.customerId === customer.id,
            ).length,
          },
        ];
      }),
    );
  const stats = campaigns.map((c) => {
    const vs = vouchers.filter((v) => v.campaignId === c.id),
      redemptions = vs.flatMap((v) =>
        v.redemption &&
        !v.redemption.voidedAt &&
        v.redemption.sale.status === "COMPLETED" &&
        ids.has(v.redemption.sale.branchId) &&
        inRange(v.redemption.createdAt)
          ? [v.redemption]
          : [],
      );
    const net = redemptions.reduce(
        (s, r) => s.plus(r.sale.net.toString()),
        D(0),
      ),
      cost = redemptions.reduce((s, r) => s.plus(r.sale.cost.toString()), D(0));
    // Campaign budget is apportioned equally across configured branches, consistently across scopes.
    const allocated = D(c.marketingCost.toString())
      .mul((c.branchIds as string[]).filter((id) => ids.has(id)).length)
      .div((c.branchIds as string[]).length);
    return {
      campaignId: c.id,
      issued: vs.filter((v) => ids.has(v.branchId) && inRange(v.issuedAt))
        .length,
      accepted: vs.filter(
        (v) => ids.has(v.branchId) && inRange(v.delivery?.acceptedAt),
      ).length,
      delivered: vs.filter(
        (v) => ids.has(v.branchId) && inRange(v.delivery?.deliveredAt),
      ).length,
      redeemed: redemptions.length,
      returning: new Set(
        redemptions
          .filter((r) =>
            customers
              .find(
                (c) =>
                  c.id === vs.find((v) => v.id === r.voucherId)?.customerId,
              )
              ?.sales.some((s) => s.createdAt < r.sale.createdAt),
          )
          .map((r) => vs.find((v) => v.id === r.voucherId)?.customerId),
      ).size,
      net: net.toFixed(2),
      discount: redemptions
        .reduce((s, r) => s.plus(r.discount.toString()), D(0))
        .toFixed(2),
      directCost: cost.toFixed(2),
      marketingCost: allocated.toFixed(2),
      contribution: net.minus(cost).minus(allocated).toFixed(2),
    };
  });
  const referrals = manager
    ? await db.referral.findMany({
        where: { branchId: { in: branchIds } },
        include: {
          referrer: { select: { name: true } },
          referred: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const config =
    u.role === "OWNER"
      ? ((await db.marketingConfig.findUnique({
          where: { id: "company" },
        })) ?? {
          deliveryEnabled: false,
          emailEnabled: false,
          emailFrom: "",
          whatsappEnabled: false,
        })
      : null;
  return JSON.parse(
    JSON.stringify({
      campaigns: campaigns.map((c) => ({
        ...c,
        branchIds: (c.branchIds as string[]).filter((id) => ids.has(id)),
        ...(!manager ? { marketingCost: undefined, message: undefined } : {}),
      })),
      vouchers: safeVouchers,
      stats: manager ? stats : [],
      progress: manager ? progress : [],
      referrals,
      config,
      readiness: u.role === "OWNER" ? providerReadiness() : null,
      asOf: dubaiDate(),
      start,
      end,
    }),
  );
}
