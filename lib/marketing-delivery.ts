import { db } from "./db";
import { canMarket } from "./crm";
import { marketingLock } from "./marketing-engine";
export function emailProvider() {
  return process.env.EMAIL_PROVIDER === "RESEND" ? "RESEND" : "SMTP";
}
export function providerReadiness() {
  return {
    liveAllowed: process.env.MARKETING_LIVE_ENABLED === "true",
    publicOrigin: !!process.env.PUBLIC_APP_ORIGIN?.startsWith("https://"),
    emailProvider: emailProvider(),
    emailReady:
      emailProvider() === "RESEND"
        ? !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET)
        : !!(
            process.env.SMTP_HOST &&
            process.env.SMTP_USER &&
            (process.env.SMTP_PASSWORD || process.env.SMTP_ACCESS_TOKEN)
          ),
    whatsappReady: !!(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_APP_SECRET &&
      process.env.WHATSAPP_VERIFY_TOKEN &&
      process.env.WHATSAPP_API_VERSION
    ),
  };
}
export async function dispatchMarketing(
  limit = 20,
  transport: typeof fetch = fetch,
) {
  const results: { id: string; status: string }[] = [];
  // A crashed send is uncertain. Never retry it automatically.
  await db.marketingDelivery.updateMany({
    where: {
      status: "SENDING",
      claimedAt: { lt: new Date(Date.now() - 600000) },
    },
    data: {
      status: "UNKNOWN",
      reason:
        "Worker stopped during send; verify provider acceptance before retry",
    },
  });
  for (let i = 0; i < Math.min(limit, 100); i++) {
    const claimed = await db.$transaction(async (tx) => {
      await marketingLock(tx);
      const config = await tx.marketingConfig.findUnique({
          where: { id: "company" },
        }),
        ready = providerReadiness();
      const settings = await tx.settings.findUniqueOrThrow({
        where: { id: "company" },
      });
      if (
        !settings.crmEnabled ||
        !config?.deliveryEnabled ||
        !ready.liveAllowed ||
        !ready.publicOrigin
      )
        return null;
      const d = await tx.marketingDelivery.findFirst({
        where: { status: "QUEUED" },
        include: { voucher: { include: { customer: true, campaign: true } } },
        orderBy: { createdAt: "asc" },
      });
      if (!d) return null;
      const v = d.voucher,
        c = v.customer;
      const channel = d.channel as "EMAIL" | "WHATSAPP";
      const destination = channel === "EMAIL" ? c.email : c.mobile;
      if (
        !canMarket(c, channel) ||
        destination !== d.destination ||
        c.sample ||
        v.status !== "ISSUED" ||
        v.expiresAt <= new Date()
      ) {
        await tx.marketingDelivery.update({
          where: { id: d.id },
          data: {
            status: "SUPPRESSED",
            reason: "Consent, contact, sample, or voucher eligibility changed",
          },
        });
        return { skip: true, id: d.id };
      }
      if (!v.campaign.active) {
        await tx.marketingDelivery.update({
          where: { id: d.id },
          data: { status: "BLOCKED", reason: "Campaign paused" },
        });
        return { skip: true, id: d.id };
      }
      if (
        (channel === "EMAIL" && (!config.emailEnabled || !ready.emailReady)) ||
        (channel === "WHATSAPP" &&
          (!config.whatsappEnabled ||
            !ready.whatsappReady ||
            !v.campaign.templateApproved ||
            !v.campaign.whatsappTemplate))
      ) {
        await tx.marketingDelivery.update({
          where: { id: d.id },
          data: {
            status: "BLOCKED",
            reason: "Provider or approved template is not configured",
          },
        });
        return { skip: true, id: d.id };
      }
      // WhatsApp template parameters: name, voucher code, expiry, offer, opt-out URL.
      await tx.marketingDelivery.update({
        where: { id: d.id },
        data: {
          status: "SENDING",
          claimedAt: new Date(),
          attempts: { increment: 1 },
          reason: "",
        },
      });
      return { skip: false, id: d.id, delivery: d, config };
    });
    if (!claimed) break;
    if (claimed.skip) {
      results.push({ id: claimed.id, status: "SKIPPED" });
      continue;
    }
    const d = claimed.delivery!;
    let status = "UNKNOWN",
      reason = "Provider acceptance uncertain; verify before retry",
      providerId: string | undefined;
    try {
      let url: string, headers: Record<string, string>, body: unknown;
      if (d.channel === "EMAIL" && emailProvider() === "SMTP") {
        const { sendSMTP } = await import("./marketing-smtp");
        const result = await sendSMTP(d, claimed.config!.emailFrom);
        status = result.status;
        reason = result.reason;
        providerId = result.providerId;
        await db.marketingDelivery.updateMany({
          where: { id: d.id, status: "SENDING" },
          data: {
            status,
            reason,
            ...(providerId ? { providerId, acceptedAt: new Date() } : {}),
          },
        });
        results.push({ id: d.id, status });
        continue;
      }
      if (d.channel === "EMAIL") {
        url = "https://api.resend.com/emails";
        headers = {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `protune-delivery-${d.id}`,
        };
        body = {
          from: claimed.config!.emailFrom,
          to: [d.destination],
          subject: d.voucher.campaign.name,
          text: d.body,
        };
      } else {
        const version = process.env.WHATSAPP_API_VERSION!;
        const phone = process.env.WHATSAPP_PHONE_NUMBER_ID!;
        if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phone))
          throw new Error("Invalid provider configuration");
        url = `https://graph.facebook.com/${version}/${phone}/messages`;
        headers = {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        };
        const { offerText } = await import("./marketing");
        const { dubaiDate } = await import("./finance");
        const values = [
          d.voucher.customer.name,
          d.voucher.code,
          dubaiDate(d.voucher.expiresAt),
          offerText(d.voucher.rules as any),
          `${process.env.PUBLIC_APP_ORIGIN}/unsubscribe/${d.unsubscribeToken}`,
        ];
        body = {
          messaging_product: "whatsapp",
          to: d.destination.replace(/^\+/, ""),
          type: "template",
          template: {
            name: d.voucher.campaign.whatsappTemplate,
            language: { code: d.voucher.campaign.templateLanguage },
            components: [
              {
                type: "body",
                parameters: values.map((text) => ({ type: "text", text })),
              },
            ],
          },
        };
      }
      const response = await transport(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) {
        const payload = await response.json();
        providerId =
          d.channel === "EMAIL" ? payload.id : payload.messages?.[0]?.id;
        if (typeof providerId === "string" && providerId.length < 300) {
          status = "ACCEPTED";
          reason = "";
        }
      } else if (response.status >= 400 && response.status < 500) {
        status = "FAILED";
        reason = `Provider rejected send (HTTP ${response.status})`;
      }
    } catch {
      /* Provider responses and credentials are never logged. */
    }
    await db.marketingDelivery.updateMany({
      where: { id: d.id, status: "SENDING" },
      data: {
        status,
        reason,
        ...(providerId ? { providerId, acceptedAt: new Date() } : {}),
      },
    });
    results.push({ id: d.id, status });
  }
  return results;
}
export async function recordDeliveryEvent(
  eventId: string,
  providerId: string,
  status: string,
) {
  const d = await db.marketingDelivery.findUnique({ where: { providerId } });
  if (!d) return;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MarketingDelivery" WHERE id=${d.id} FOR UPDATE`;
    if (await tx.marketingEvent.findUnique({ where: { id: eventId } })) return;
    await tx.marketingEvent.create({
      data: { id: eventId, deliveryId: d.id, status },
    });
    const current = await tx.marketingDelivery.findUniqueOrThrow({
      where: { id: d.id },
    });
    if (
      current.status === "DELIVERED" ||
      (current.status === "FAILED" && status === "ACCEPTED")
    )
      return;
    await tx.marketingDelivery.update({
      where: { id: d.id },
      data: {
        status,
        ...(status === "DELIVERED"
          ? { deliveredAt: new Date(), reason: "" }
          : status === "FAILED"
            ? { reason: "Provider reported delivery failure" }
            : {}),
      },
    });
  });
}
