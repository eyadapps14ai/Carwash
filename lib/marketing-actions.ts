import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertAccess, canBranch } from "./auth";
import { businessDate } from "./finance-actions";
import { D, dubaiDate } from "./finance";
import { providerReadiness } from "./marketing-delivery";
import { issueVoucher, marketingLock, runMarketing } from "./marketing-engine";
type Actor = { id: string; role: string; branches: { branchId: string }[] };
const id = z.string().min(1).max(100),
  amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const campaignSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(160),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,40}$/),
  kind: z.enum([
    "PROMOTION",
    "NEXT_VISIT",
    "LOYALTY_VISITS",
    "LOYALTY_SPEND",
    "REFERRAL",
    "REACTIVATION",
  ]),
  active: z.boolean(),
  branchIds: z.array(id).min(1).max(100),
  serviceIds: z.array(id).max(100),
  startDate: businessDate,
  endDate: businessDate,
  discountKind: z.enum(["PERCENT", "FIXED", "FREE_SERVICE"]),
  discountValue: amount,
  minimumSpend: amount,
  expiryDays: z.number().int().min(1).max(365),
  threshold: amount,
  inactivityDays: z.number().int().min(1).max(3650),
  maxPerCustomer: z.number().int().min(1).max(10000),
  maxRedemptions: z.number().int().min(1).max(1000000),
  channel: z.enum(["PREFERRED", "EMAIL", "WHATSAPP"]),
  message: z.string().min(1).max(2000),
  whatsappTemplate: z
    .string()
    .regex(/^[a-z0-9_]*$/)
    .max(100),
  templateLanguage: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
  templateApproved: z.boolean(),
  marketingCost: amount,
});
export async function marketingAction(
  tx: Prisma.TransactionClient,
  u: Actor,
  action: string,
  input: unknown,
): Promise<string | undefined> {
  if (
    ![
      "campaign",
      "campaignStatus",
      "voucherIssue",
      "voucherVoid",
      "referral",
      "marketingConfig",
      "marketingRun",
      "deliveryRetry",
      "deliveryResolve",
    ].includes(action)
  )
    return;
  assertAccess(u, ["OWNER", "MANAGER"]);
  await marketingLock(tx);
  const audit = async (
    entityId: string,
    detail: Prisma.InputJsonValue,
    branchId?: string,
  ) =>
    tx.audit.create({
      data: { userId: u.id, action, entityId, detail, branchId },
    });
  if (action === "campaign") {
    assertAccess(u, ["OWNER"]);
    const v = campaignSchema.parse(input);
    const branches = [...new Set(v.branchIds)].sort(),
      services = [...new Set(v.serviceIds)].sort();
    if (
      v.endDate < v.startDate ||
      D(v.threshold).lte(0) ||
      (["LOYALTY_VISITS"].includes(v.kind) && !D(v.threshold).isInteger()) ||
      (v.discountKind === "PERCENT" && D(v.discountValue).gt(100)) ||
      (v.discountKind !== "FREE_SERVICE" && D(v.discountValue).lte(0))
    )
      throw new Error(
        "Check campaign dates, positive reward thresholds, and discount values",
      );
    if (
      (await tx.branch.count({
        where: { id: { in: branches }, active: true },
      })) !== branches.length ||
      (await tx.service.count({ where: { id: { in: services } } })) !==
        services.length
    )
      throw new Error("Select valid branches and services");
    if (!v.message.includes("{code}") || !v.message.includes("{unsubscribe}"))
      throw new Error("Message must include {code} and {unsubscribe}");
    const old = v.id
      ? await tx.campaign.findUniqueOrThrow({ where: { id: v.id } })
      : null;
    if (
      old &&
      ((await tx.voucher.count({ where: { campaignId: old.id } })) ||
        (await tx.referral.count({ where: { campaignId: old.id } })))
    ) {
      const fixed = [
        "code",
        "kind",
        "startDate",
        "endDate",
        "discountKind",
        "discountValue",
        "minimumSpend",
        "expiryDays",
        "threshold",
        "inactivityDays",
        "maxPerCustomer",
        "maxRedemptions",
      ] as const;
      if (
        fixed.some((k) => old[k].toString() !== v[k].toString()) ||
        JSON.stringify(old.branchIds) !== JSON.stringify(branches) ||
        JSON.stringify(old.serviceIds) !== JSON.stringify(services)
      )
        throw new Error(
          "Issued campaign rules are preserved. Create a new campaign to change reward rules or limits.",
        );
    }
    const { id: campaignId, ...data } = v;
    const c = campaignId
      ? await tx.campaign.update({
          where: { id: campaignId },
          data: { ...data, branchIds: branches, serviceIds: services },
        })
      : await tx.campaign.create({
          data: {
            ...data,
            branchIds: branches,
            serviceIds: services,
            createdBy: u.id,
          },
        });
    await audit(c.id, { name: c.name, active: c.active });
    return c.id;
  }
  if (action === "campaignStatus") {
    assertAccess(u, ["OWNER"]);
    const v = z.object({ id, active: z.boolean() }).parse(input);
    await tx.campaign.update({
      where: { id: v.id },
      data: { active: v.active },
    });
    await audit(v.id, { active: v.active });
    return v.id;
  }
  if (action === "marketingConfig") {
    assertAccess(u, ["OWNER"]);
    const v = z
      .object({
        deliveryEnabled: z.boolean(),
        emailEnabled: z.boolean(),
        emailFrom: z.string().max(200),
        whatsappEnabled: z.boolean(),
      })
      .parse(input);
    if (v.emailEnabled && !z.string().email().safeParse(v.emailFrom).success)
      throw new Error("Use a verified sender email address");
    if (v.deliveryEnabled && process.env.MARKETING_LIVE_ENABLED !== "true")
      throw new Error(
        "Live delivery must first be enabled in secure server configuration",
      );
    if (v.deliveryEnabled && v.emailEnabled && !providerReadiness().emailReady)
      throw new Error("Email provider credentials are not configured");
    if (
      v.deliveryEnabled &&
      v.whatsappEnabled &&
      (!process.env.WHATSAPP_ACCESS_TOKEN ||
        !process.env.WHATSAPP_PHONE_NUMBER_ID ||
        !process.env.WHATSAPP_APP_SECRET ||
        !process.env.WHATSAPP_VERIFY_TOKEN ||
        !process.env.WHATSAPP_API_VERSION)
    )
      throw new Error("WhatsApp provider credentials are not configured");
    if (
      v.deliveryEnabled &&
      !process.env.PUBLIC_APP_ORIGIN?.startsWith("https://")
    )
      throw new Error(
        "Configure the public HTTPS application origin before live delivery",
      );
    await tx.marketingConfig.upsert({
      where: { id: "company" },
      create: v,
      update: v,
    });
    await audit("company", v);
    return "company";
  }
  if (action === "marketingRun") {
    assertAccess(u, ["OWNER"]);
    await runMarketing(tx);
    await audit("company", { runner: "manual" });
    return "company";
  }
  if (action === "deliveryRetry" || action === "deliveryResolve") {
    assertAccess(u, ["OWNER"]);
    const v = z
      .object({
        id,
        reason: z.string().trim().min(5).max(500),
        notSent: z.boolean().optional(),
      })
      .parse(input);
    const delivery = await tx.marketingDelivery.findUniqueOrThrow({
      where: { id: v.id },
    });
    if (action === "deliveryResolve") {
      if (delivery.status !== "UNKNOWN" || !v.notSent)
        throw new Error(
          "Resolve an uncertain send only after provider evidence confirms it was not sent",
        );
      await tx.marketingDelivery.update({
        where: { id: v.id },
        data: {
          status: "FAILED",
          reason: "Owner confirmed provider did not accept send",
        },
      });
    } else {
      if (!["BLOCKED", "FAILED"].includes(delivery.status))
        throw new Error(
          "Only blocked or confirmed failed deliveries can be retried",
        );
      await tx.marketingDelivery.update({
        where: { id: v.id },
        data: { status: "QUEUED", reason: "", claimedAt: null },
      });
    }
    await audit(v.id, { reason: v.reason });
    return v.id;
  }
  const v = z
    .object({
      id: id.optional(),
      campaignId: id.optional(),
      customerId: id.optional(),
      branchId: id.optional(),
      requestKey: z.string().uuid().optional(),
      referrerId: id.optional(),
      referredId: id.optional(),
      reason: z.string().max(500).optional(),
    })
    .parse(input);
  if (action === "voucherVoid") {
    if (!v.id || !v.reason?.trim())
      throw new Error("A voucher and reason are required");
    const voucher = await tx.voucher.findUniqueOrThrow({ where: { id: v.id } });
    assertAccess(u, ["OWNER", "MANAGER"], voucher.branchId);
    if (voucher.status !== "ISSUED")
      throw new Error("Only unused vouchers can be revoked");
    await tx.voucher.update({ where: { id: v.id }, data: { status: "VOID" } });
    await tx.marketingDelivery.updateMany({
      where: { voucherId: v.id, status: { in: ["QUEUED", "BLOCKED"] } },
      data: { status: "SUPPRESSED", reason: "Voucher revoked" },
    });
    await audit(v.id, { reason: v.reason }, voucher.branchId);
    return v.id;
  }
  if (!v.campaignId || !v.branchId)
    throw new Error("Select campaign and branch");
  assertAccess(u, ["OWNER", "MANAGER"], v.branchId);
  const c = await tx.campaign.findUniqueOrThrow({
    where: { id: v.campaignId },
  });
  if (
    !c.active ||
    dubaiDate() < c.startDate ||
    dubaiDate() > c.endDate ||
    !(c.branchIds as string[]).includes(v.branchId)
  )
    throw new Error("Campaign is unavailable");
  if (
    !(await tx.settings.findUniqueOrThrow({ where: { id: "company" } }))
      .crmEnabled
  )
    throw new Error("Enable customer management first");
  if (action === "voucherIssue") {
    if (!v.customerId || !v.requestKey || c.kind !== "PROMOTION")
      throw new Error(
        "Manual issuance uses a promotion and a registered customer",
      );
    const voucher = await issueVoucher(
      tx,
      c,
      v.customerId,
      v.branchId,
      `manual:${v.requestKey}`,
    );
    if (!voucher) throw new Error("Campaign issuance limit reached");
    await audit(voucher.id, { campaignId: c.id }, v.branchId);
    return voucher.id;
  }
  if (
    !v.referrerId ||
    !v.referredId ||
    v.referrerId === v.referredId ||
    c.kind !== "REFERRAL"
  )
    throw new Error("Select different customers for a referral campaign");
  for (const customerId of [v.referrerId, v.referredId])
    if (
      !(await tx.customer.findFirst({
        where: {
          id: customerId,
          active: true,
          branches: { some: { branchId: v.branchId } },
        },
      }))
    )
      throw new Error("Customers must belong to the referral branch");
  if (await tx.sale.count({ where: { customerId: v.referredId } }))
    throw new Error(
      "Register referrals before the new customer has any invoice",
    );
  const referral = await tx.referral.create({
    data: {
      campaignId: c.id,
      referrerId: v.referrerId,
      referredId: v.referredId,
      branchId: v.branchId,
      createdBy: u.id,
    },
  });
  await audit(referral.id, { campaignId: c.id }, v.branchId);
  return referral.id;
}
