import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
const base = process.env.APP_ORIGIN!;
async function login(email: string, password: string) {
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: {
      origin: base,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("protune_session="));
  return cookie!;
}
async function action(
  cookie: string,
  action: string,
  data: unknown,
  origin = base,
) {
  const res = await fetch(base + "/api/action", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  return { status: res.status, body: await res.json() };
}
async function main() {
  const owner = await login(
    process.env.SEED_OWNER_EMAIL!,
    process.env.SEED_OWNER_PASSWORD!,
  );
  const branches = await db.branch.findMany({ orderBy: { code: "asc" } });
  const first = branches[0],
    second = branches[1];
  const service = await db.branchService.findFirstOrThrow({
    where: { branchId: first.id, active: true },
    include: { service: true },
  });
  const password = randomUUID() + randomUUID(),
    suffix = randomUUID().slice(0, 8);
  const users = [];
  for (const role of ["MANAGER", "CASHIER", "TECHNICIAN"] as const)
    users.push(
      await db.user.create({
        data: {
          name: `Integration ${role}`,
          email: `integration-${role.toLowerCase()}-${suffix}@protune.local`,
          passwordHash: hashPassword(password),
          role,
          branches: { create: { branchId: first.id } },
        },
      }),
    );
  const saleIds: string[] = [],
    fixtureIds: string[] = [];
  let fixtureBranch: string | undefined,
    fixtureExpense: string | undefined,
    fixtureService: string | undefined,
    fixtureCategory: string | undefined;
  try {
    const manager = await login(users[0].email, password),
      cashier = await login(users[1].email, password),
      technician = await login(users[2].email, password);
    const branchResult = await action(owner, "branch", {
      name: `Integration branch ${suffix}`,
      code: `TEST-${suffix}`,
      active: true,
    });
    assert.equal(branchResult.status, 200);
    fixtureBranch = branchResult.body.id;
    fixtureIds.push(fixtureBranch!);
    const categoryResult = await action(owner, "category", {
      name: `Integration category ${suffix}`,
    });
    assert.equal(categoryResult.status, 200);
    fixtureCategory = categoryResult.body.id;
    fixtureIds.push(fixtureCategory!);
    const serviceResult = await action(owner, "service", {
      name: "Integration configurable service",
      categoryId: fixtureCategory,
      duration: 30,
      labor: 2,
      materials: "Test materials",
      active: true,
      prices: [
        {
          branchId: fixtureBranch,
          price: "50",
          active: true,
          costs: [
            {
              name: "Supplies",
              mode: "QUANTITY",
              amount: "2.50",
              quantity: "2",
              source: "DIRECT",
            },
          ],
        },
      ],
    });
    assert.equal(serviceResult.status, 200);
    fixtureService = serviceResult.body.id;
    fixtureIds.push(fixtureService!);
    assert.equal(
      (
        await db.branchService.findFirstOrThrow({
          where: { serviceId: fixtureService },
        })
      ).price.toString(),
      "50",
    );
    const expenseResult = await action(manager, "expense", {
      branchId: first.id,
      category: "Rent",
      description: "Temporary integration expense",
      amount: "123.45",
      date: "2026-10-08",
      frequency: "MONTHLY",
      kind: "FIXED",
      active: true,
    });
    assert.equal(expenseResult.status, 200);
    fixtureExpense = expenseResult.body.id;
    fixtureIds.push(fixtureExpense!);
    assert.equal(
      (
        await action(owner, "user", {
          id: users[2].id,
          name: users[2].name,
          email: users[2].email,
          password: "",
          role: "TECHNICIAN",
          title: "Integration updated technician",
          salary: "100",
          schedule: "Test schedule",
          active: true,
          branchIds: [first.id],
        })
      ).status,
      200,
    );
    const technicianUpdated = await login(users[2].email, password);
    assert.equal(
      (
        await action(
          owner,
          "branch",
          { name: "Blocked", code: "BLOCK", active: true },
          "https://invalid.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers: { origin: base, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    const input = {
      branchId: first.id,
      requestKey: randomUUID(),
      serviceIds: [service.serviceId],
      workerIds: users.map((u) => u.id),
      plate: "TEST INTEGRATION",
      customerName: "Temporary integration test",
      discount: "0",
      paid: "0",
      method: "CASH",
    };
    assert.equal(
      (await action(manager, "sale", { ...input, branchId: second.id })).status,
      400,
    );
    assert.equal(
      (await action(cashier, "sale", { ...input, discount: "1" })).status,
      400,
    );
    assert.equal((await action(technicianUpdated, "sale", input)).status, 400);
    const sale = await action(owner, "sale", input);
    assert.equal(sale.status, 200);
    saleIds.push(sale.body.id);
    assert.equal((await action(owner, "sale", input)).body.id, sale.body.id);
    assert.equal(
      await db.sale.count({ where: { requestKey: input.requestKey } }),
      1,
    );
    let record = await db.sale.findUniqueOrThrow({
      where: { id: sale.body.id },
      include: { workers: true, payments: true, lines: true },
    });
    assert.equal(record.workers.length, 3);
    assert.equal(record.lines.length, 1);
    assert.equal(record.subtotal.toString(), service.price.toString());
    const payment = {
      id: record.id,
      amount: record.total.toString(),
      method: "CARD",
      requestKey: randomUUID(),
    };
    const concurrent = await Promise.all([
      action(cashier, "payment", payment),
      action(cashier, "payment", { ...payment, requestKey: randomUUID() }),
    ]);
    assert.equal(concurrent.filter((r) => r.status === 200).length, 1);
    assert.equal(concurrent.filter((r) => r.status === 400).length, 1);
    assert.equal((await action(cashier, "payment", payment)).status, 200);
    assert.equal(await db.payment.count({ where: { saleId: record.id } }), 1);
    assert.equal(
      (
        await action(manager, "cancel", {
          id: record.id,
          reason: "Test paid cancellation",
        })
      ).status,
      400,
    );
    const techPage = await fetch(base, {
      headers: { cookie: technicianUpdated },
    });
    const techHtml = await techPage.text();
    assert.equal(techPage.status, 200);
    assert.ok(techHtml.includes("My jobs"));
    assert.ok(!techHtml.includes("passwordHash"));
    assert.ok(!techHtml.includes("costSnapshot"));
    const otherSale = await db.sale.findFirst({
      where: { branchId: second.id },
    });
    if (otherSale)
      assert.equal(
        (
          await fetch(base + "/receipt/" + otherSale.id, {
            headers: { cookie: manager },
          })
        ).status,
        404,
      );
    const receipt = await fetch(base + "/receipt/" + record.id, {
      headers: { cookie: owner },
    });
    assert.equal(receipt.status, 200);
    assert.ok((await receipt.text()).includes(record.number));
    const secretPage = await fetch(base, { headers: { cookie: cashier } });
    const html = await secretPage.text();
    assert.ok(!html.includes("passwordHash"));
    assert.ok(!html.includes("Fictional sample expense"));
    const oldPrice = service.price.toString();
    await db.branchService.update({
      where: { id: service.id },
      data: { price: "987.65" },
    });
    const snapshot = await db.sale.findUniqueOrThrow({
      where: { id: record.id },
    });
    assert.equal(snapshot.subtotal.toString(), oldPrice);
    await db.branchService.update({
      where: { id: service.id },
      data: { price: oldPrice },
    });
    const unpaid = await action(owner, "sale", {
      ...input,
      requestKey: randomUUID(),
      workerIds: [],
    });
    assert.equal(unpaid.status, 200);
    saleIds.push(unpaid.body.id);
    assert.equal(
      (
        await action(manager, "cancel", {
          id: unpaid.body.id,
          reason: "Unpaid test cancellation",
        })
      ).status,
      200,
    );
    assert.equal(
      (await action(owner, "removeService", { id: fixtureService })).status,
      200,
    );
    fixtureService = undefined;
    assert.equal(
      (await action(owner, "removeCategory", { id: fixtureCategory })).status,
      200,
    );
    fixtureCategory = undefined;
    console.log(
      "Integration checks passed: branch/category/service/account/expense administration, unused catalog removal, authentication, CSRF, branch/role restrictions, sale idempotency, team revenue, concurrent payment protection, payment idempotency, receipt access, sensitive-data exclusion, historical price snapshots, and unpaid cancellation.",
    );
  } finally {
    await db.audit.deleteMany({
      where: {
        OR: [
          {
            entityId: {
              in: [...saleIds, ...fixtureIds, ...users.map((u) => u.id)],
            },
          },
          { userId: { in: users.map((u) => u.id) } },
        ],
      },
    });
    if (fixtureExpense) {
      await db.expenseRevision.deleteMany({
        where: { expenseId: fixtureExpense },
      });
      await db.expense.deleteMany({ where: { id: fixtureExpense } });
    }
    if (fixtureService) {
      await db.branchService.deleteMany({
        where: { serviceId: fixtureService },
      });
      await db.service.deleteMany({ where: { id: fixtureService } });
    }
    if (fixtureCategory)
      await db.category.deleteMany({ where: { id: fixtureCategory } });
    if (fixtureBranch)
      await db.branch.deleteMany({ where: { id: fixtureBranch } });
    await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.saleWorker.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.saleLine.deleteMany({ where: { saleId: { in: saleIds } } });
    await db.sale.deleteMany({ where: { id: { in: saleIds } } });
    await db.session.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await db.assignment.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
