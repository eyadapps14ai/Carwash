import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
async function main() {
  const email = process.env.SEED_OWNER_EMAIL,
    password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Configure a unique owner email and password of at least 12 characters",
    );
  if (await db.user.count())
    throw new Error("Bootstrap only supports an empty database");
  await db.$transaction(async (tx) => {
    await tx.settings.create({ data: { id: "company", sampleMode: false } });
    const branches = [];
    for (const branch of [
      { name: "Dubai Silicon Oasis", code: "DSO" },
      { name: "Dubai Investments Park", code: "DIP" },
    ])
      branches.push(await tx.branch.create({ data: branch }));
    await tx.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        name: "Business owner",
        role: "OWNER",
        branches: { create: branches.map((b) => ({ branchId: b.id })) },
      },
    });
    for (const name of [
      "Car washing",
      "Car detailing",
      "Mechanical services",
      "Oil services",
      "Additional services",
    ])
      await tx.category.create({ data: { name } });
    for (const name of [
      "Rent",
      "Salaries",
      "Employee benefits",
      "Electricity",
      "Water",
      "Internet",
      "Insurance",
      "Trade license",
      "Maintenance",
      "Marketing",
      "Equipment",
      "Other",
    ])
      await tx.expenseCategory.create({ data: { name } });
  });
  console.log(
    "Empty operational workspace created. No fictional financial records.",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
