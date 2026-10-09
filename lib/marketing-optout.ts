import { db } from "./db";
export async function optOut(customerId: string, evidence: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId} FOR UPDATE`;
    const c = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    if (c.marketingOptOut && !c.consentEmail && !c.consentWhatsApp) return;
    await tx.customer.update({
      where: { id: customerId },
      data: {
        marketingOptOut: true,
        consentEmail: false,
        consentWhatsApp: false,
      },
    });
    await tx.consentEvent.create({
      data: {
        customerId,
        email: false,
        whatsApp: false,
        optOut: true,
        evidence,
        recordedBy: "customer-opt-out",
      },
    });
    await tx.marketingDelivery.updateMany({
      where: { voucher: { customerId }, status: { in: ["QUEUED", "BLOCKED"] } },
      data: { status: "SUPPRESSED", reason: "Customer opted out" },
    });
  });
}
