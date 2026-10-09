import { db } from "../lib/db";
import { snapshotService } from "../lib/operations-actions";
import { saleTotals } from "../lib/finance";
async function main() {
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.sampleMode)
    throw new Error(
      "Workshop samples are restricted to the fictional sample workspace",
    );
  const owner = await db.user.findFirstOrThrow({
    where: { role: "OWNER", active: true },
  });
  for (const code of ["DSO", "DIP"]) {
    const branch = await db.branch.findUnique({ where: { code } });
    if (!branch) continue;
    if (
      await db.jobCard.findUnique({
        where: { requestKey: `phase3-sample:${code}` },
      })
    )
      continue;
    const tech = await db.user.findFirst({
        where: {
          role: "TECHNICIAN",
          active: true,
          branches: { some: { branchId: branch.id } },
        },
      }),
      service = await db.branchService.findFirst({
        where: { branchId: branch.id, active: true, service: { active: true } },
        include: { service: true },
      });
    await db.$transaction(async (tx) => {
      const j = await tx.jobCard.create({
        data: {
          number: `JC-SAMPLE-${code}`,
          requestKey: `phase3-sample:${code}`,
          branchId: branch.id,
          customerName: "Sample customer — fictional",
          plate: `SAMPLE ${code}`,
          vehicle: code === "DSO" ? "Sample sedan" : "Sample SUV",
          requestedWork:
            code === "DSO"
              ? "Inspect vehicle and prepare a service quotation (fictional sample)"
              : "Prepare a detailing quotation for customer approval (fictional sample)",
          sample: true,
          status: code === "DSO" ? "INSPECTION" : "QUOTATION",
          assignments: { create: tech ? [{ userId: tech.id }] : [] },
          events: {
            create: {
              status: code === "DSO" ? "INSPECTION" : "QUOTATION",
              actorId: owner.id,
              note: "Fictional workshop sample; no revenue, payment, or stock consumption recorded.",
            },
          },
        },
      });
      if (code === "DIP" && service) {
        const line = await snapshotService(tx, branch.id, service.serviceId),
          totals = saleTotals([line], "0", settings.vatRate.toString());
        await tx.quotationRevision.create({
          data: {
            jobId: j.id,
            version: 1,
            lines: [line] as any,
            subtotal: totals.subtotal,
            discount: totals.discount,
            vat: totals.vat,
            total: totals.total,
            vatRate: settings.vatRate,
            createdBy: owner.id,
          },
        });
      }
    });
  }
  console.log(
    "Labeled fictional workshop cards ready; no revenue or stock movements posted.",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
