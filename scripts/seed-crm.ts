import { db } from "../lib/db";
async function main() {
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.sampleMode)
    throw new Error("CRM samples require the fictional sample workspace");
  for (const code of ["DSO", "DIP"]) {
    const branch = await db.branch.findUnique({ where: { code } });
    if (!branch) continue;
    const customer = await db.customer.upsert({
      where: { requestKey: `phase4-sample:${code}` },
      update: {},
      create: {
        requestKey: `phase4-sample:${code}`,
        name: `Sample ${code} customer — fictional`,
        email: `sample-${code.toLowerCase()}@example.test`,
        sample: true,
        notes:
          "Fictional preview profile; no contact permission or financial postings.",
        branches: { create: { branchId: branch.id } },
      },
    });
    for (const plate of [`SAMPLE ${code}`, `DEMO ${code} 2`])
      await db.vehicle.upsert({
        where: {
          customerId_plateKey: {
            customerId: customer.id,
            plateKey: plate.replaceAll(" ", ""),
          },
        },
        update: {},
        create: {
          customerId: customer.id,
          plate,
          plateKey: plate.replaceAll(" ", ""),
          make: "Sample",
          model: code === "DSO" ? "Sedan" : "SUV",
          category: code === "DSO" ? "Sedan" : "SUV",
        },
      });
    const vehicle = await db.vehicle.findFirstOrThrow({
      where: { customerId: customer.id, plate: `SAMPLE ${code}` },
    });
    await db.jobCard.updateMany({
      where: {
        requestKey: `phase3-sample:${code}`,
        sample: true,
        customerId: null,
      },
      data: { customerId: customer.id, vehicleId: vehicle.id },
    });
  }
  await db.settings.update({
    where: { id: "company" },
    data: { crmEnabled: true },
  });
  console.log(
    "Fictional CRM preview profiles added, opted out; no financial postings.",
  );
}
main().finally(() => db.$disconnect());
