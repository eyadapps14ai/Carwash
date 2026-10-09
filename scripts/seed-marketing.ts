import { db } from "../lib/db";
import { issueVoucher, marketingLock } from "../lib/marketing-engine";
import { dubaiDate } from "../lib/finance";
async function main() {
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.sampleMode)
    throw new Error("Marketing samples require a fictional sample workspace");
  const owner = await db.user.findFirstOrThrow({ where: { role: "OWNER" } }),
    branches = await db.branch.findMany({
      where: { code: { in: ["DSO", "DIP"] } },
    });
  await db.$transaction(async (tx) => {
    await marketingLock(tx);
    const c = await tx.campaign.upsert({
      where: { code: "SAMPLE-RETURN10" },
      update: {},
      create: {
        name: "Sample return offer — fictional",
        code: "SAMPLE-RETURN10",
        kind: "PROMOTION",
        active: true,
        branchIds: branches.map((b) => b.id).sort(),
        serviceIds: [],
        startDate: dubaiDate(),
        endDate: `${Number(dubaiDate().slice(0, 4)) + 1}-12-31`,
        discountKind: "PERCENT",
        discountValue: "10",
        minimumSpend: "50",
        expiryDays: 30,
        threshold: "5",
        maxPerCustomer: 5,
        maxRedemptions: 100,
        createdBy: owner.id,
      },
    });
    for (const branch of branches) {
      const customer = await tx.customer.findUnique({
        where: { requestKey: `phase4-sample:${branch.code}` },
      });
      if (customer?.sample)
        await issueVoucher(
          tx,
          c,
          customer.id,
          branch.id,
          `phase5-sample:${branch.code}`,
        );
    }
    await tx.marketingConfig.upsert({
      where: { id: "company" },
      create: {},
      update: {},
    });
  });
  console.log(
    "Fictional campaign and opted-out digital vouchers added. No messages or financial postings.",
  );
}
main().finally(() => db.$disconnect());
