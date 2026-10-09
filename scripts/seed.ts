import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { Cost, serviceCost, saleTotals, dubaiDate } from "../lib/finance";
import { randomUUID } from "node:crypto";
async function seed() {
  const email = process.env.SEED_OWNER_EMAIL?.toLowerCase(),
    password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Set SEED_OWNER_EMAIL and a unique SEED_OWNER_PASSWORD (12+ characters). No default passwords are supplied.",
    );
  if (await db.user.count())
    throw new Error(
      "Seeding requires an empty database; existing records are never reset.",
    );
  await db.$transaction(
    async (tx) => {
      await tx.settings.create({
        data: { id: "company", sampleMode: true, vatRate: 5 },
      });
      const branches = await Promise.all(
        [
          { name: "Dubai Silicon Oasis", code: "DSO" },
          { name: "Dubai Investments Park", code: "DIP" },
        ].map((b) => tx.branch.create({ data: b })),
      );
      const owner = await tx.user.create({
        data: {
          name: "Business owner",
          email,
          passwordHash: hashPassword(password),
          role: "OWNER",
          title: "Owner",
          salary: 0,
          branches: { create: branches.map((b) => ({ branchId: b.id })) },
        },
      });
      const employees = await Promise.all(
        [
          {
            name: "Omar Hassan",
            title: "Wash technician",
            role: "TECHNICIAN" as const,
            salary: 2800,
            branch: 0,
          },
          {
            name: "Arjun Kumar",
            title: "Detailing specialist",
            role: "TECHNICIAN" as const,
            salary: 3500,
            branch: 0,
          },
          {
            name: "Daniel Reyes",
            title: "Service technician",
            role: "TECHNICIAN" as const,
            salary: 3200,
            branch: 1,
          },
        ].map((e, i) =>
          tx.user.create({
            data: {
              name: e.name,
              title: e.title,
              role: e.role,
              salary: e.salary,
              email: `sample.employee${i + 1}@protune.local`,
              passwordHash: hashPassword(randomUUID() + randomUUID()),
              active: true,
              branches: { create: { branchId: branches[e.branch].id } },
            },
          }),
        ),
      );
      const definitions: Record<string, [string, number, number][]> = {
        "Car washing": [
          ["Sedan exterior wash", 35, 20],
          ["Sedan full wash", 50, 30],
          ["SUV exterior wash", 45, 25],
          ["SUV full wash", 65, 40],
          ["Premium wash", 95, 50],
        ],
        "Car detailing": [
          ["Interior detailing", 350, 180],
          ["Exterior detailing", 300, 150],
          ["Polishing", 450, 240],
          ["Ceramic coating", 1500, 480],
        ],
        "Mechanical services": [
          ["General mechanical repairs", 250, 90],
          ["Engine services", 600, 180],
          ["Brake services", 300, 120],
          ["Suspension services", 450, 180],
        ],
        "Oil services": [
          ["Oil changes", 180, 45],
          ["Oil filter replacement", 75, 20],
          ["Fluid replacement", 120, 30],
        ],
        "Additional services": [
          ["Tire services", 100, 30],
          ["Battery replacement", 450, 30],
          ["Air conditioning services", 200, 60],
        ],
      };
      const costs: Cost[] = [
        { name: "Water", mode: "FIXED", amount: "2", source: "DIRECT" },
        { name: "Electricity", mode: "FIXED", amount: "1", source: "DIRECT" },
        {
          name: "Chemicals",
          mode: "QUANTITY",
          amount: "3",
          quantity: "1",
          source: "DIRECT",
        },
        { name: "Materials", mode: "FIXED", amount: "2", source: "DIRECT" },
        {
          name: "Incremental labor",
          mode: "FIXED",
          amount: "7",
          source: "DIRECT",
        },
      ];
      const configs = [];
      for (const [category, items] of Object.entries(definitions)) {
        const c = await tx.category.create({ data: { name: category } });
        for (const [name, price, duration] of items) {
          const s = await tx.service.create({
            data: {
              name,
              categoryId: c.id,
              duration,
              materials:
                category === "Car washing"
                  ? "Shampoo, water, microfiber"
                  : "Configure specific material requirements",
            },
          });
          for (const b of branches) {
            const cs =
              category === "Car washing"
                ? costs
                : [
                    {
                      name: "Sample consumables / parts",
                      mode: "PERCENT" as const,
                      amount: "35",
                      source: "DIRECT" as const,
                    },
                  ];
            configs.push(
              await tx.branchService.create({
                data: {
                  serviceId: s.id,
                  branchId: b.id,
                  price: price + (b.code === "DIP" ? 5 : 0),
                  costs: cs,
                },
                include: { service: { include: { category: true } } },
              }),
            );
          }
        }
      }
      const today = dubaiDate();
      const day = Number(today.slice(-2));
      for (let d = 1; d <= day; d++) {
        for (let b = 0; b < 2; b++) {
          for (let j = 0; j < 4 + (d % 4); j++) {
            const config = configs.filter(
              (c) =>
                c.branchId === branches[b].id &&
                c.service.category.name === "Car washing",
            )[(j + d) % 5];
            const cost = serviceCost(
                config.price.toString(),
                config.costs as Cost[],
              ),
              totals = saleTotals(
                [{ price: config.price.toString(), cost }],
                0,
                5,
              );
            const key = randomUUID();
            await tx.sale.create({
              data: {
                number: `SAMPLE-${branches[b].code}-${String(d).padStart(2, "0")}-${j + 1}`,
                requestKey: key,
                branchId: branches[b].id,
                cashierId: owner.id,
                createdAt: new Date(
                  `${today.slice(0, 7)}-${String(d).padStart(2, "0")}T${String(9 + j).padStart(2, "0")}:30:00+04:00`,
                ),
                plate: `DUBAI ${b ? "B" : "A"} ${12000 + d * 10 + j}`,
                customerName: "Sample walk-in",
                ...totals,
                vatRate: 5,
                sample: true,
                lines: {
                  create: {
                    serviceId: config.serviceId,
                    name: config.service.name,
                    category: config.service.category.name,
                    price: config.price,
                    cost,
                    costSnapshot: config.costs as any,
                  },
                },
                workers: {
                  create: { userId: employees[b === 0 ? j % 2 : 2].id },
                },
                payments: {
                  create: {
                    amount: totals.total,
                    method: j % 2 ? "CARD" : "CASH",
                    requestKey: key,
                  },
                },
              },
            });
          }
        }
      }
      const categories = [
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
      ];
      for (const name of categories)
        await tx.expenseCategory.create({ data: { name } });
      for (const b of branches) {
        for (const [category, amount, frequency] of [
          ["Rent", 7000, "MONTHLY"],
          ["Salaries", b.code === "DSO" ? 6300 : 3200, "MONTHLY"],
          ["Internet", 350, "MONTHLY"],
          ["Insurance", 2400, "ANNUAL"],
          ["Marketing", 450, "ONCE"],
        ] as const)
          await tx.expense.create({
            data: {
              branchId: b.id,
              category,
              description: "Fictional sample expense — replace after review",
              amount,
              date: new Date(`${today.slice(0, 7)}-01T00:00:00+04:00`),
              frequency,
              sample: true,
            },
          });
      }
      await tx.audit.create({
        data: {
          userId: owner.id,
          action: "sample_seed",
          entityId: "company",
          detail: {
            description: "Fictional records created for local testing",
          },
        },
      });
    },
    { timeout: 60000 },
  );
  console.log(
    "Sample workspace seeded. Sign in with your configured owner credentials.",
  );
}
seed()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
