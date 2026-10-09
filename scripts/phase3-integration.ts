import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { dubaiDate, D } from "../lib/finance";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
const origin = process.env.APP_ORIGIN!,
  suffix = randomUUID().slice(0, 8),
  today = dubaiDate();
async function login(email: string, password: string) {
  const r = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  assert.equal(r.status, 303);
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function action(cookie: string, action: string, data: unknown) {
  const r = await fetch(origin + "/api/action", {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  return { status: r.status, data: await r.json() };
}
async function get(cookie: string, path: string) {
  return fetch(origin + path, { headers: { cookie } });
}
async function main() {
  let branches: string[] = [],
    users: string[] = [],
    itemId = "",
    categoryId = "",
    serviceId = "";
  const owner = await login(
      process.env.SEED_OWNER_EMAIL!,
      process.env.SEED_OWNER_PASSWORD!,
    ),
    password = randomUUID() + randomUUID();
  const initialSettings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  try {
    for (const code of ["A", "B"]) {
      const b = await action(owner, "branch", {
        name: `Phase 3 ${code} ${suffix}`,
        code: `P3${code}-${suffix}`,
        active: true,
      });
      assert.equal(b.status, 200);
      branches.push(b.data.id);
    }
    const [a, b] = branches;
    for (const [role, name] of [
      ["TECHNICIAN", "one"],
      ["TECHNICIAN", "two"],
      ["MANAGER", "manager"],
      ["CASHIER", "cashier"],
    ] as const) {
      const u = await db.user.create({
        data: {
          name: `P3 ${name}`,
          email: `p3-${name}-${suffix}@protune.local`,
          passwordHash: hashPassword(password),
          role,
          branches: { create: { branchId: a } },
        },
      });
      users.push(u.id);
    }
    const tech = await login(`p3-one-${suffix}@protune.local`, password),
      tech2 = await login(`p3-two-${suffix}@protune.local`, password),
      manager = await login(`p3-manager-${suffix}@protune.local`, password),
      cashier = await login(`p3-cashier-${suffix}@protune.local`, password);
    const item = await action(owner, "inventoryItem", {
      name: "Test consumable",
      sku: `P3-${suffix}`,
      category: "Chemicals",
      unit: "litre",
      supplier: "Test supplier",
      active: true,
    });
    assert.equal(item.status, 200);
    itemId = item.data.id;
    const receive = {
      branchId: a,
      itemId,
      kind: "RECEIPT",
      quantity: "20",
      unitCost: "2",
      requestKey: randomUUID(),
      note: "Test opening stock",
    };
    const r = await action(owner, "stockMove", receive);
    assert.equal(r.status, 200);
    assert.equal(
      (await action(owner, "stockMove", receive)).data.id,
      r.data.id,
    );
    assert.equal(
      (
        await action(owner, "stockMove", {
          ...receive,
          requestKey: randomUUID(),
          quantity: "10",
          unitCost: "5",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await db.branchStock.findUniqueOrThrow({
          where: { branchId_itemId: { branchId: a, itemId } },
        })
      ).unitCost.toFixed(6),
      "3.000000",
    );
    assert.equal(
      (
        await action(tech, "stockMove", {
          ...receive,
          requestKey: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(manager, "stockMove", {
          ...receive,
          branchId: b,
          requestKey: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await action(cashier, "inventoryItem", { name: "Denied" })).status,
      400,
    );
    const transfer = {
      fromBranchId: a,
      toBranchId: b,
      itemId,
      quantity: "5",
      requestKey: randomUUID(),
      note: "Test paired transfer",
    };
    const t = await action(owner, "stockTransfer", transfer);
    assert.equal(t.status, 200);
    assert.equal(
      (await action(owner, "stockTransfer", transfer)).data.id,
      t.data.id,
    );
    assert.equal(
      await db.stockMovement.count({
        where: { reference: transfer.requestKey },
      }),
      2,
    );
    assert.equal(
      (
        await action(manager, "stockTransfer", {
          ...transfer,
          requestKey: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(owner, "stockMove", {
          ...receive,
          requestKey: randomUUID(),
          kind: "ADJUST_OUT",
          quantity: "26",
        })
      ).status,
      400,
    );
    const cat = await action(owner, "category", { name: `P3 test ${suffix}` });
    categoryId = cat.data.id;
    const serviceBody = {
      name: "P3 test wash",
      categoryId,
      duration: 30,
      labor: 1,
      materials: "Test",
      active: true,
      prices: [
        {
          branchId: a,
          price: "50",
          active: true,
          costs: [
            {
              name: "Chemical estimate",
              mode: "FIXED",
              amount: "10",
              source: "DIRECT",
            },
            {
              name: "Other direct",
              mode: "FIXED",
              amount: "5",
              source: "DIRECT",
            },
            { name: "Salary", mode: "FIXED", amount: "7", source: "PAYROLL" },
          ],
        },
      ],
    };
    const service = await action(owner, "service", serviceBody);
    assert.equal(service.status, 200);
    serviceId = service.data.id;
    assert.equal(
      (
        await action(manager, "serviceMaterials", {
          branchId: a,
          serviceId,
          materials: [
            { itemId, quantity: "1", replaceCostNames: ["Chemical estimate"] },
          ],
        })
      ).status,
      200,
    );
    const create = {
      branchId: a,
      requestKey: randomUUID(),
      customerName: "Test customer",
      customerPhone: "0500000000",
      plate: "P3 TEMP",
      vehicle: "Test vehicle",
      requestedWork: "Temporary integration job",
      workerIds: users.slice(0, 2),
    };
    const job = await action(cashier, "jobCreate", create);
    assert.equal(job.status, 200);
    const jobId = job.data.id;
    assert.equal((await action(cashier, "jobCreate", create)).data.id, jobId);
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "COMPLETED",
          note: "Invalid skip",
        })
      ).status,
      400,
    );
    assert.equal((await action(tech, "jobQuote", { id: jobId })).status, 400);
    const quoteBody = {
      id: jobId,
      serviceIds: [serviceId],
      laborName: "Extra labor",
      laborCharge: "20",
      otherCost: "2",
      discount: "2",
      parts: [{ itemId, quantity: "1", sellingPrice: "12" }],
    };
    assert.equal((await action(manager, "jobQuote", quoteBody)).status, 200);
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "IN_PROGRESS",
          note: "No approval",
        })
      ).status,
      400,
    );
    let q = await db.quotationRevision.findFirstOrThrow({
      where: { jobId },
      orderBy: { version: "desc" },
    });
    assert.equal(q.total.toString(), "84");
    const approve = {
      id: jobId,
      quotationId: q.id,
      customerName: "Test customer",
      method: "IN_PERSON",
      evidence: "Test written acceptance",
    };
    assert.equal((await action(cashier, "jobApproval", approve)).status, 200);
    assert.equal((await action(manager, "jobQuote", quoteBody)).status, 200);
    assert.equal((await action(cashier, "jobApproval", approve)).status, 400);
    q = await db.quotationRevision.findFirstOrThrow({
      where: { jobId },
      orderBy: { version: "desc" },
    });
    assert.equal(
      (await action(cashier, "jobApproval", { ...approve, quotationId: q.id }))
        .status,
      200,
    );
    assert.equal(
      (
        await action(owner, "service", {
          ...serviceBody,
          id: serviceId,
          prices: [{ ...serviceBody.prices[0], price: "100" }],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "IN_PROGRESS",
          note: "Approved work started",
        })
      ).status,
      200,
    );
    assert.equal(
      (await action(owner, "operationsSettings", { attendanceEnabled: true }))
        .status,
      200,
    );
    assert.equal(
      (await action(tech, "attendanceIn", { branchId: a })).status,
      200,
    );
    assert.equal(
      (await action(tech, "attendanceIn", { branchId: a })).status,
      400,
    );
    assert.equal((await action(tech, "attendanceOut", {})).status, 200);
    assert.equal(
      (
        await action(manager, "operationsSettings", {
          attendanceEnabled: false,
        })
      ).status,
      400,
    );
    const timer = await action(tech, "jobTimeStart", { id: jobId });
    assert.equal(timer.status, 200);
    assert.equal(
      (await action(tech, "jobTimeStart", { id: jobId })).status,
      400,
    );
    assert.equal(
      (
        await action(tech2, "jobTimeStop", {
          id: timer.data.id,
          note: "Unauthorized",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "COMPLETED",
          note: "Timer still running",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(tech, "jobTimeStop", {
          id: timer.data.id,
          note: "Test completed",
        })
      ).status,
      200,
    );
    const extraTimer = await action(tech, "jobTimeStart", { id: jobId });
    assert.equal(extraTimer.status, 200);
    assert.equal(
      (
        await action(manager, "jobTimeStop", {
          id: extraTimer.data.id,
          note: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(manager, "jobTimeStop", {
          id: extraTimer.data.id,
          note: "Manager correction: forgotten running timer",
        })
      ).status,
      200,
    );
    await db.periodClose.create({
      data: {
        branchId: b,
        month: today.slice(0, 7),
        snapshot: {},
        closedBy: "integration",
      },
    });
    assert.equal(
      (
        await action(owner, "stockTransfer", {
          ...transfer,
          requestKey: randomUUID(),
        })
      ).status,
      400,
    );
    await db.periodClose.deleteMany({ where: { branchId: b } });
    const before = (
      await db.branchStock.findUniqueOrThrow({
        where: { branchId_itemId: { branchId: a, itemId } },
      })
    ).quantity;
    const completed = await Promise.all([
      action(tech, "jobStatus", {
        id: jobId,
        status: "COMPLETED",
        note: "Complete",
      }),
      action(tech2, "jobStatus", {
        id: jobId,
        status: "COMPLETED",
        note: "Retry completion",
      }),
    ]);
    assert.ok(completed.every((r) => r.status === 200));
    assert.equal(
      (
        await db.branchStock.findUniqueOrThrow({
          where: { branchId_itemId: { branchId: a, itemId } },
        })
      ).quantity.toString(),
      before.minus(2).toString(),
    );
    assert.equal(
      await db.stockMovement.count({ where: { jobId, kind: "CONSUMPTION" } }),
      2,
    );
    assert.equal((await action(tech, "jobInvoice", { id: jobId })).status, 400);
    const invoices = await Promise.all([
      action(cashier, "jobInvoice", { id: jobId }),
      action(manager, "jobInvoice", { id: jobId }),
    ]);
    assert.ok(invoices.every((r) => r.status === 200));
    assert.equal(invoices[0].data.id, invoices[1].data.id);
    const sale = await db.sale.findUniqueOrThrow({
      where: { id: invoices[0].data.id },
      include: { lines: true },
    });
    assert.equal(sale.net.toString(), "80");
    assert.equal(sale.total.toString(), "84");
    assert.equal(sale.cost.toString(), "13");
    assert.equal(
      (
        await action(owner, "cancel", {
          id: sale.id,
          reason: "Blocked stock cancellation",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(cashier, "payment", {
          id: sale.id,
          amount: "30",
          method: "CARD",
          requestKey: randomUUID(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(cashier, "jobStatus", {
          id: jobId,
          status: "DELIVERED",
          note: "Customer collected; balance tracked separately",
        })
      ).status,
      200,
    );
    const quick = {
      branchId: a,
      serviceIds: [serviceId],
      workerIds: [users[0]],
      plate: "P3 QUICK",
      customerName: "Test",
      discount: "0",
      paid: "0",
      method: "CASH",
      requestKey: randomUUID(),
    };
    const checkout = await action(cashier, "sale", quick);
    assert.equal(checkout.status, 200);
    assert.equal(
      (await action(cashier, "sale", quick)).data.id,
      checkout.data.id,
    );
    assert.equal(
      (
        await db.sale.findUniqueOrThrow({ where: { id: checkout.data.id } })
      ).cost.toString(),
      "8",
    );
    assert.equal(
      await db.stockMovement.count({ where: { saleId: checkout.data.id } }),
      1,
    );
    const data = await (
      await get(
        manager,
        `/api/operations?branch=${a}&start=${today}&end=${today}`,
      )
    ).json();
    assert.equal(data.error, undefined);
    assert.equal(data.jobs.length, 1);
    assert.equal(
      data.productivity.find((p: any) => p.id === users[1]).revenue,
      "40.00",
    );
    assert.equal(
      data.productivity.find((p: any) => p.id === users[0]).revenue,
      "140.00",
    );
    const techData = await (
      await get(tech, `/api/operations?branch=${a}`)
    ).json();
    assert.ok(!JSON.stringify(techData.jobs).includes("customerPhone"));
    assert.ok(!JSON.stringify(techData.jobs).includes("unitCost"));
    assert.ok(!JSON.stringify(techData.jobs).includes("subtotal"));
    assert.equal(techData.items.length, 0);
    assert.equal(
      (await get(manager, `/api/operations?branch=${b}`)).status,
      403,
    );
    assert.equal(
      (await get(tech, `/api/operations?branch=${a}&format=csv`)).status,
      403,
    );
    for (const format of ["csv", "xlsx", "pdf"]) {
      const r = await get(
        owner,
        `/api/operations?branch=${a}&start=${today}&end=${today}&format=${format}&report=Inventory%20movement`,
      );
      assert.equal(r.status, 200);
      if (format === "csv") assert.ok((await r.text()).includes("CONSUMPTION"));
      else if (format === "pdf")
        assert.ok(
          (await PDFDocument.load(await r.arrayBuffer())).getPageCount() > 0,
        );
      else {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
        assert.ok(book.getWorksheet("Inventory movement"));
      }
    }
    await mkdir(".local/phase3-qa", { recursive: true });
    for (const name of ["Inventory usage", "Employee productivity"]) {
      for (const format of ["xlsx", "pdf"]) {
        const response = await get(
          owner,
          `/api/operations?branch=${a}&start=${today}&end=${today}&format=${format}&report=${encodeURIComponent(name)}`,
        );
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(
          `.local/phase3-qa/${name.toLowerCase().replaceAll(" ", "-")}.${format}`,
          bytes,
        );
        if (name === "Inventory usage" && format === "xlsx") {
          const book = new ExcelJS.Workbook();
          await book.xlsx.load(bytes as any);
          assert.equal(book.getWorksheet(name)!.getCell("E7").value, 3);
          assert.equal(book.getWorksheet(name)!.getCell("F7").value, 9);
        }
      }
    }
    // Concurrent withdrawals cannot overspend branch stock.
    const remaining = (
      await db.branchStock.findUniqueOrThrow({
        where: { branchId_itemId: { branchId: a, itemId } },
      })
    ).quantity.toString();
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        action(owner, "stockMove", {
          ...receive,
          requestKey: randomUUID(),
          kind: "ADJUST_OUT",
          quantity: remaining,
          note: "Concurrent stock limit test",
        }),
      ),
    );
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 400]);
    const n = await db.sale.count({ where: { branchId: a } });
    assert.equal(
      (await action(cashier, "sale", { ...quick, requestKey: randomUUID() }))
        .status,
      400,
    );
    assert.equal(await db.sale.count({ where: { branchId: a } }), n);
    console.log(
      "Phase 3 integration passed: weighted costing, transfer bounds/idempotency, branch and role restrictions, approved revision snapshots, technician clocks, one-time completion and stock deduction, one-time invoices, partial payments, checkout recipes, atomic shortage rollback, concurrent stock limits, financial redaction, productivity and CSV/Excel/PDF exports.",
    );
  } finally {
    await db.settings.update({
      where: { id: "company" },
      data: { attendanceEnabled: initialSettings.attendanceEnabled },
    });
    if (branches.length) {
      const jobs = await db.jobCard.findMany({
          where: { branchId: { in: branches } },
          select: { id: true },
        }),
        jobIds = jobs.map((j) => j.id),
        sales = await db.sale.findMany({
          where: { branchId: { in: branches } },
          select: { id: true },
        }),
        saleIds = sales.map((s) => s.id);
      await db.audit.deleteMany({
        where: {
          OR: [
            { branchId: { in: branches } },
            { entityId: { in: [itemId, serviceId, categoryId] } },
            { userId: { in: users } },
          ],
        },
      });
      await db.periodClose.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.stockMovement.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.technicianTime.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.jobEvent.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.quotationApproval.deleteMany({
        where: { quotation: { jobId: { in: jobIds } } },
      });
      await db.quotationRevision.deleteMany({
        where: { jobId: { in: jobIds } },
      });
      await db.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
      await db.jobCard.deleteMany({ where: { id: { in: jobIds } } });
      await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.saleWorker.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.saleLine.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.sale.deleteMany({ where: { id: { in: saleIds } } });
      await db.branchStock.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.attendance.deleteMany({ where: { branchId: { in: branches } } });
      await db.branchService.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.assignment.deleteMany({ where: { branchId: { in: branches } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    }
    if (itemId) await db.inventoryItem.deleteMany({ where: { id: itemId } });
    if (serviceId) await db.service.deleteMany({ where: { id: serviceId } });
    if (categoryId) await db.category.deleteMany({ where: { id: categoryId } });
  }
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
