import { Prisma, Campaign } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { D, dubaiDate } from "./finance";
import { canMarket } from "./crm";
import {
  VoucherRules,
  offerText,
  renderMarketingMessage,
  voucherDiscount,
  eligibleNet,
  fullyPaid,
  inactiveDays,
} from "./marketing";
type Tx = Prisma.TransactionClient;
export async function marketingLock(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(510005)::text`;
}
export function campaignRules(c: Campaign): VoucherRules {
  return {
    branchIds: c.branchIds as string[],
    serviceIds: c.serviceIds as string[],
    discountKind: c.discountKind,
    discountValue: c.discountValue.toString(),
    minimumSpend: c.minimumSpend.toString(),
    campaignName: c.name,
  };
}
export async function issueVoucher(
  tx: Tx,
  c: Campaign,
  customerId: string,
  branchId: string,
  issueKey: string,
  sourceSaleId?: string,
) {
  const existing = await tx.voucher.findUnique({ where: { issueKey } });
  if (existing) return existing;
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { branches: true },
  });
  if (
    !customer.active ||
    !customer.branches.some((b) => b.branchId === branchId) ||
    !(c.branchIds as string[]).includes(branchId)
  )
    return null;
  const issued = await tx.voucher.count({
    where: { campaignId: c.id, customerId, status: { not: "VOID" } },
  });
  if (
    issued >= c.maxPerCustomer ||
    (await tx.voucher.count({
      where: { campaignId: c.id, status: { not: "VOID" } },
    })) >= c.maxRedemptions
  )
    return null;
  const rules = campaignRules(c),
    now = new Date(),
    expiresAt = new Date(now.getTime() + c.expiryDays * 86400000);
  // Bound expiry to the campaign's Dubai end date.
  const campaignEnd = new Date(c.endDate + "T23:59:59.999+04:00");
  if (expiresAt > campaignEnd) expiresAt.setTime(campaignEnd.getTime());
  const v = await tx.voucher.create({
    data: {
      code: "PT-" + randomBytes(9).toString("hex").toUpperCase(),
      issueKey,
      campaignId: c.id,
      customerId,
      branchId,
      sourceSaleId,
      rules: rules as any,
      expiresAt,
      sample: customer.sample,
    },
  });
  const channel =
    c.channel === "PREFERRED" ? customer.preferredChannel : c.channel;
  const valid =
    (channel === "EMAIL" || channel === "WHATSAPP") &&
    canMarket(customer, channel);
  const token = randomBytes(32).toString("hex"),
    origin = process.env.PUBLIC_APP_ORIGIN ?? process.env.APP_ORIGIN ?? "";
  const unsubscribe = `${origin}/unsubscribe/${token}`;
  const body = renderMarketingMessage(c.message, {
    name: customer.name,
    code: v.code,
    expiry: dubaiDate(expiresAt),
    offer: offerText(rules),
    unsubscribe,
  });
  await tx.marketingDelivery.create({
    data: {
      voucherId: v.id,
      channel,
      destination: channel === "EMAIL" ? customer.email : customer.mobile,
      unsubscribeToken: token,
      body,
      status: valid && !customer.sample ? "QUEUED" : "SUPPRESSED",
      reason: customer.sample
        ? "Fictional sample: delivery suppressed"
        : valid
          ? ""
          : "No consent for the selected channel",
    },
  });
  return v;
}
export async function evaluateCustomer(
  tx: Tx,
  customerId: string,
  now = new Date(),
) {
  const settings = await tx.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.crmEnabled) return;
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: { branches: true },
  });
  if (!customer?.active) return;
  const today = dubaiDate(now),
    campaigns = await tx.campaign.findMany({
      where: {
        active: true,
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });
  const sales = await tx.sale.findMany({
    where: { customerId, status: "COMPLETED" },
    include: { payments: true, lines: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const paid = sales.filter(fullyPaid);
  for (const c of campaigns) {
    const branchIds = c.branchIds as string[],
      serviceIds = c.serviceIds as string[];
    const available = customer.branches
      .map((b) => b.branchId)
      .filter((b) => branchIds.includes(b));
    if (!available.length) continue;
    const eligible = paid.filter(
      (s) =>
        branchIds.includes(s.branchId) &&
        dubaiDate(s.createdAt) >= c.startDate &&
        dubaiDate(s.createdAt) <= c.endDate &&
        s.lines.some(
          (l) => !serviceIds.length || serviceIds.includes(l.serviceId),
        ),
    );
    if (c.kind === "NEXT_VISIT")
      for (const s of eligible)
        if (D(s.net.toString()).gte(c.threshold))
          await issueVoucher(
            tx,
            c,
            customerId,
            s.branchId,
            `next:${c.id}:${s.id}`,
            s.id,
          );
    if (c.kind === "LOYALTY_VISITS" || c.kind === "LOYALTY_SPEND") {
      let progress = D(0),
        milestone = 0;
      for (const s of eligible) {
        progress = progress.plus(
          c.kind === "LOYALTY_VISITS" ? 1 : eligibleNet(s, serviceIds),
        );
        const reached = progress.div(c.threshold.toString()).floor().toNumber();
        while (milestone < Math.min(reached, c.maxPerCustomer)) {
          milestone++;
          await issueVoucher(
            tx,
            c,
            customerId,
            s.branchId,
            `loyalty:${c.id}:${customerId}:${milestone}`,
            s.id,
          );
        }
      }
    }
    if (c.kind === "REACTIVATION") {
      // Latest completed visit, including an unpaid visit, ends the inactivity cycle.
      const visits = sales.filter((s) => branchIds.includes(s.branchId));
      const last = visits.at(-1);
      if (
        last &&
        inactiveDays(last.createdAt, now) >= c.inactivityDays &&
        canMarket(
          customer,
          c.channel === "PREFERRED" ? customer.preferredChannel : c.channel,
        )
      )
        await issueVoucher(
          tx,
          c,
          customerId,
          last.branchId,
          `reactivation:${c.id}:${customerId}:${last.id}`,
          last.id,
        );
    }
    if (c.kind === "REFERRAL") {
      const referral = await tx.referral.findUnique({
        where: {
          campaignId_referredId: { campaignId: c.id, referredId: customerId },
        },
      });
      // Reward only a newly referred customer's first invoice, fully settled after registration.
      const first = paid[0];
      const firstEver = await tx.sale.findFirst({
        where: { customerId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (
        referral &&
        !referral.qualifiedSaleId &&
        first &&
        first.id === firstEver?.id &&
        first.createdAt >= referral.createdAt &&
        eligible.some((s) => s.id === first.id) &&
        D(first.net.toString()).gte(c.threshold)
      ) {
        const reward = await issueVoucher(
          tx,
          c,
          referral.referrerId,
          referral.branchId,
          `referral:${referral.id}`,
          first.id,
        );
        if (reward)
          await tx.referral.update({
            where: { id: referral.id },
            data: { qualifiedSaleId: first.id },
          });
      }
    }
  }
}
export async function resolveVoucher(
  tx: Tx,
  code: string | undefined,
  customerId: string | undefined,
  branchId: string,
  lines: { serviceId: string; price: any }[],
  requestKey: string,
) {
  if (!code?.trim()) return null;
  if (!customerId)
    throw new Error("Select the registered customer to redeem a voucher");
  if (
    !(await tx.settings.findUniqueOrThrow({ where: { id: "company" } }))
      .crmEnabled
  )
    throw new Error("Enable customer management to redeem vouchers");
  const normalized = code.trim().toUpperCase();
  let v = await tx.voucher.findUnique({
    where: { code: normalized },
    include: { campaign: true },
  });
  if (!v) {
    const c = await tx.campaign.findUnique({ where: { code: normalized } });
    if (!c || c.kind !== "PROMOTION")
      throw new Error("Voucher or promotion code is invalid");
    if (!c.active || dubaiDate() < c.startDate || dubaiDate() > c.endDate)
      throw new Error("Promotion is inactive or expired");
    const issued = await issueVoucher(
      tx,
      c,
      customerId,
      branchId,
      `promotion:${requestKey}`,
    );
    if (!issued) throw new Error("Campaign issuance limit reached");
    v = await tx.voucher.findUniqueOrThrow({
      where: { issueKey: `promotion:${requestKey}` },
      include: { campaign: true },
    });
  }
  if (v.customerId !== customerId)
    throw new Error("This voucher belongs to a different customer");
  if (!v.campaign.active || v.status !== "ISSUED" || v.expiresAt <= new Date())
    throw new Error("Voucher is unavailable, expired, or already used");
  if (dubaiDate() < v.campaign.startDate || dubaiDate() > v.campaign.endDate)
    throw new Error("Campaign is outside its validity dates");
  const redemptions = await tx.voucherRedemption.count({
    where: { voucher: { campaignId: v.campaignId }, voidedAt: null },
  });
  if (redemptions >= v.campaign.maxRedemptions)
    throw new Error("Campaign redemption limit reached");
  const used = await tx.voucherRedemption.count({
    where: {
      voucher: { campaignId: v.campaignId, customerId },
      voidedAt: null,
    },
  });
  if (used >= v.campaign.maxPerCustomer)
    throw new Error("Customer campaign usage limit reached");
  const discount = voucherDiscount(
    v.rules as unknown as VoucherRules,
    branchId,
    lines.map((l) => ({ serviceId: l.serviceId, price: l.price.toString() })),
  );
  if (discount.lte(0))
    throw new Error("Voucher has no discount on these services");
  return { voucher: v, discount };
}
export async function redeemVoucher(
  tx: Tx,
  result: NonNullable<Awaited<ReturnType<typeof resolveVoucher>>>,
  saleId: string,
) {
  await tx.voucherRedemption.create({
    data: { voucherId: result.voucher.id, saleId, discount: result.discount },
  });
  await tx.voucher.update({
    where: { id: result.voucher.id },
    data: { status: "REDEEMED" },
  });
  // A code used at checkout needs no later promotional delivery.
  await tx.marketingDelivery.updateMany({
    where: {
      voucherId: result.voucher.id,
      status: { in: ["QUEUED", "BLOCKED"] },
    },
    data: { status: "SUPPRESSED", reason: "Voucher already redeemed" },
  });
}
export async function runMarketing(tx: Tx) {
  await marketingLock(tx);
  const customers = await tx.customer.findMany({
    where: { active: true },
    select: { id: true },
  });
  for (const c of customers) await evaluateCustomer(tx, c.id);
  return customers.length;
}
