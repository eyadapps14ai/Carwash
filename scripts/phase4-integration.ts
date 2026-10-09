import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { dubaiDate } from "../lib/finance";
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
  const original = await db.settings.findUniqueOrThrow({
      where: { id: "company" },
    }),
    owner = await login(
      process.env.SEED_OWNER_EMAIL!,
      process.env.SEED_OWNER_PASSWORD!,
    ),
    password = randomUUID() + randomUUID();
  let branches: string[] = [],
    users: string[] = [],
    customers: string[] = [],
    categoryId = "",
    serviceId = "";
  try {
    assert.equal(
      (await action(owner, "crmSettings", { crmEnabled: true })).status,
      200,
    );
    for (const code of ["A", "B"]) {
      const r = await action(owner, "branch", {
        name: `P4 ${code} ${suffix}`,
        code: `P4${code}-${suffix}`,
        active: true,
      });
      assert.equal(r.status, 200);
      branches.push(r.data.id);
    }
    const [a, b] = branches;
    for (const role of ["MANAGER", "CASHIER", "TECHNICIAN"] as const) {
      const u = await db.user.create({
        data: {
          name: `P4 ${role}`,
          email: `p4-${role.toLowerCase()}-${suffix}@protune.local`,
          role,
          passwordHash: hashPassword(password),
          branches: { create: { branchId: a } },
        },
      });
      users.push(u.id);
    }
    const manager = await login(`p4-MANAGER-${suffix}@protune.local`, password),
      cashier = await login(`p4-CASHIER-${suffix}@protune.local`, password),
      tech = await login(`p4-TECHNICIAN-${suffix}@protune.local`, password);
    const profile = {
      branchId: a,
      requestKey: randomUUID(),
      name: '=HYPERLINK("test")',
      mobile: "050 123 4567",
      email: "p4@example.test",
      preferredChannel: "WHATSAPP",
      notes: "Private management note",
      active: true,
    };
    const c = await action(manager, "customer", profile);
    assert.equal(c.status, 200);
    const customerId = c.data.id;
    customers.push(customerId);
    assert.equal(
      (await action(manager, "customer", profile)).data.id,
      customerId,
    );
    assert.equal(
      (
        await action(manager, "customer", {
          ...profile,
          requestKey: randomUUID(),
          mobile: "+971501234567",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(tech, "customer", {
          ...profile,
          requestKey: randomUUID(),
          mobile: "",
        })
      ).status,
      400,
    );
    const another = await action(owner, "customer", {
      ...profile,
      branchId: b,
      requestKey: randomUUID(),
      name: "Other branch customer",
      mobile: "",
      notes: "",
    });
    assert.equal(another.status, 200);
    customers.push(another.data.id);
    const vehicleInput = {
      customerId,
      plate: "Dubai A-123",
      make: "Test make",
      model: "Test model",
      year: 2024,
      category: "Sedan",
      active: true,
    };
    const veh = await action(manager, "vehicle", vehicleInput);
    assert.equal(veh.status, 200);
    const vehicleId = veh.data.id;
    assert.equal(
      (
        await action(manager, "vehicle", {
          ...vehicleInput,
          plate: "DUBAI A 123",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(owner, "vehicle", {
          ...vehicleInput,
          customerId: another.data.id,
          plate: "Dubai B 456",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "vehicle", {
          ...vehicleInput,
          id: vehicleId,
          customerId: another.data.id,
        })
      ).status,
      400,
    );
    let stored = await db.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    assert.equal(stored.marketingOptOut, true);
    assert.equal(stored.consentWhatsApp, false);
    assert.equal(
      (
        await action(manager, "customerConsent", {
          id: customerId,
          email: true,
          whatsApp: true,
          optOut: false,
          evidence: "Test explicit customer permission",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "customer", {
          ...profile,
          id: customerId,
          email: "new@example.test",
        })
      ).status,
      200,
    );
    stored = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(stored.consentEmail, false);
    assert.equal(stored.consentWhatsApp, true);
    assert.equal(
      (
        await action(manager, "customerConsent", {
          id: customerId,
          email: false,
          whatsApp: false,
          optOut: true,
          evidence: "Customer opted out",
        })
      ).status,
      200,
    );
    const cat = await action(owner, "category", { name: `P4 test ${suffix}` });
    categoryId = cat.data.id;
    const service = await action(owner, "service", {
      name: "P4 service",
      categoryId,
      duration: 30,
      labor: 1,
      materials: "None",
      active: true,
      prices: branches.map((branchId) => ({
        branchId,
        price: "50",
        active: true,
        costs: [
          { name: "Direct", mode: "FIXED", amount: "15", source: "DIRECT" },
        ],
      })),
    });
    assert.equal(service.status, 200);
    serviceId = service.data.id;
    const saleInput = {
      branchId: a,
      requestKey: randomUUID(),
      serviceIds: [serviceId],
      workerIds: [users[2]],
      plate: "WRONG OVERRIDE",
      customerName: "WRONG OVERRIDE",
      customerId,
      vehicleId,
      discount: "0",
      paid: "20",
      method: "CASH",
    };
    const s = await action(cashier, "sale", saleInput);
    assert.equal(s.status, 200);
    const saleId = s.data.id;
    const invoice = await db.sale.findUniqueOrThrow({ where: { id: saleId } });
    assert.equal(invoice.customerName, profile.name);
    assert.equal(invoice.plate, "DUBAI A-123");
    assert.equal(invoice.customerId, customerId);
    assert.equal(invoice.vehicleId, vehicleId);
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleInput,
          requestKey: randomUUID(),
          customerId: another.data.id,
        })
      ).status,
      400,
    );
    const visit = await action(cashier, "sale", {
      ...saleInput,
      requestKey: randomUUID(),
      paid: "0",
    });
    assert.equal(visit.status, 200);
    assert.equal(
      (
        await action(owner, "cancel", {
          id: visit.data.id,
          reason: "Test unpaid cancellation",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "customer", {
          ...profile,
          id: customerId,
          name: "Renamed profile",
          email: "new@example.test",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "vehicle", {
          ...vehicleInput,
          id: vehicleId,
          make: "Changed make",
        })
      ).status,
      200,
    );
    assert.equal(
      (await db.sale.findUniqueOrThrow({ where: { id: saleId } })).customerName,
      profile.name,
    );
    const rec = await action(manager, "recommendation", {
      customerId,
      vehicleId,
      branchId: a,
      title: "Inspect brakes",
      notes: "Test recommendation",
      dueDate: today,
      status: "OPEN",
    });
    assert.equal(rec.status, 200);
    assert.equal(
      (
        await action(manager, "recommendation", {
          id: rec.data.id,
          customerId,
          vehicleId,
          branchId: a,
          title: "Inspect brakes",
          notes: "Done",
          dueDate: today,
          status: "DONE",
        })
      ).status,
      200,
    );
    const job = await action(cashier, "jobCreate", {
      branchId: a,
      requestKey: randomUUID(),
      customerName: "Manual",
      customerPhone: "",
      plate: "Manual",
      vehicle: "Manual",
      customerId,
      vehicleId,
      requestedWork: "P4 linked job",
      workerIds: [users[2]],
    });
    assert.equal(job.status, 200);
    const jobId = job.data.id;
    assert.equal(
      (
        await action(manager, "jobQuote", {
          id: jobId,
          serviceIds: [serviceId],
          laborName: "Extra",
          laborCharge: "0",
          otherCost: "0",
          discount: "0",
          parts: [],
        })
      ).status,
      200,
    );
    const q = await db.quotationRevision.findFirstOrThrow({ where: { jobId } });
    assert.equal(
      (
        await action(cashier, "jobApproval", {
          id: jobId,
          quotationId: q.id,
          customerName: "Test customer",
          method: "IN_PERSON",
          evidence: "Accepted test quote",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "IN_PROGRESS",
          note: "Started",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(tech, "jobStatus", {
          id: jobId,
          status: "COMPLETED",
          note: "Finished",
        })
      ).status,
      200,
    );
    assert.equal(
      (await action(owner, "crmSettings", { crmEnabled: false })).status,
      200,
    );
    assert.equal((await get(manager, `/api/crm?branch=${a}`)).status, 409);
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleInput,
          requestKey: randomUUID(),
        })
      ).status,
      400,
    );
    const jobInvoice = await action(cashier, "jobInvoice", { id: jobId });
    assert.equal(jobInvoice.status, 200);
    assert.equal(
      (await db.sale.findUniqueOrThrow({ where: { id: jobInvoice.data.id } }))
        .customerId,
      customerId,
    );
    const walkin = await action(cashier, "sale", {
      branchId: a,
      requestKey: randomUUID(),
      serviceIds: [serviceId],
      workerIds: [],
      plate: "DUBAI A-123",
      customerName: "Historic walk-in",
      discount: "0",
      paid: "0",
      method: "CASH",
    });
    assert.equal(walkin.status, 200);
    assert.equal(
      (await action(owner, "crmSettings", { crmEnabled: true })).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "linkCustomer", {
          id: walkin.data.id,
          type: "SALE",
          customerId,
          vehicleId,
        })
      ).status,
      200,
    );
    assert.equal(
      (await db.sale.findUniqueOrThrow({ where: { id: walkin.data.id } }))
        .customerName,
      "Historic walk-in",
    );
    assert.equal(
      (
        await action(owner, "linkCustomer", {
          id: walkin.data.id,
          type: "SALE",
          customerId: another.data.id,
          vehicleId: null,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(owner, "customerBranches", {
          id: customerId,
          branchIds: [a, b],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(manager, "customer", {
          ...profile,
          id: customerId,
          name: "Forbidden shared edit",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(manager, "customerBranches", {
          id: customerId,
          branchIds: [a],
        })
      ).status,
      400,
    );
    await db.assignment.create({ data: { userId: users[2], branchId: b } });
    const branchBVisit = await action(owner, "sale", {
      ...saleInput,
      branchId: b,
      requestKey: randomUUID(),
      paid: "0",
    });
    assert.equal(branchBVisit.status, 200, JSON.stringify(branchBVisit.data));
    assert.equal(
      (
        await action(owner, "customerBranches", {
          id: customerId,
          branchIds: [a],
        })
      ).status,
      400,
    );
    const response = await get(
      manager,
      `/api/crm?branch=${a}&customer=${customerId}`,
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.customers[0].sales.length, 4);
    assert.equal(data.customers[0].visits, 3);
    assert.equal(data.customers[0].net, "150.00");
    assert.equal(data.customers[0].balance, "137.50");
    assert.equal(data.customers[0].canEdit, false);
    assert.equal(data.customers[0].branches.length, 1);
    assert.equal((await get(manager, `/api/crm?branch=${b}`)).status, 403);
    assert.equal(
      (await get(manager, `/api/crm?branch=${a}&customer=${another.data.id}`))
        .status,
      404,
    );
    assert.equal((await get(tech, `/api/crm?branch=${a}`)).status, 403);
    const cashierData = await (
      await get(cashier, `/api/crm?branch=${a}`)
    ).json();
    assert.ok(!JSON.stringify(cashierData).includes("Private management note"));
    assert.equal(
      (await get(cashier, `/api/crm?branch=${a}&format=csv`)).status,
      403,
    );
    assert.equal(
      (await action(manager, "crmSettings", { crmEnabled: false })).status,
      400,
    );
    // Current balances include later collections while spending uses invoice dates.
    assert.equal(
      (
        await action(cashier, "payment", {
          id: saleId,
          amount: "32.50",
          method: "CARD",
          requestKey: randomUUID(),
        })
      ).status,
      200,
    );
    await mkdir(".local/phase4-qa", { recursive: true });
    for (const type of ["Customer spending", "Customer history"])
      for (const format of ["csv", "xlsx", "pdf"]) {
        const r = await get(
          manager,
          `/api/crm?branch=${a}&customer=${customerId}&start=${today}&end=${today}&report=${encodeURIComponent(type)}&format=${format}`,
        );
        assert.equal(r.status, 200);
        assert.ok(r.headers.get("cache-control")?.includes("no-store"));
        const bytes = Buffer.from(await r.arrayBuffer());
        await writeFile(
          `.local/phase4-qa/${type.toLowerCase().replaceAll(" ", "-")}.${format}`,
          bytes,
        );
        if (format === "xlsx") {
          const book = new ExcelJS.Workbook();
          await book.xlsx.load(bytes as any);
          assert.ok(book.getWorksheet(type));
          if (type === "Customer spending") {
            assert.equal(book.getWorksheet(type)!.getCell("D7").value, 3);
            assert.equal(book.getWorksheet(type)!.getCell("E7").value, 150);
            assert.equal(book.getWorksheet(type)!.getCell("H7").value, 105);
          }
        } else if (format === "pdf")
          assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
      }
    const latest = await (
      await get(manager, `/api/crm?branch=${a}&customer=${customerId}`)
    ).json();
    assert.equal(latest.customers[0].balance, "105.00");
    assert.equal(
      (
        await get(
          manager,
          `/api/crm?branch=${a}&format=pdf&start=2026-02-30&end=${today}`,
        )
      ).status,
      400,
    );
    console.log(
      "Phase 4 integration passed: CRM switch, scoped profiles/history, normalized duplicate contacts/plates, consent and contact-change revocation, vehicle ownership, linked checkout/jobs/invoices, immutable snapshots, verified historical linking, cancelled invoice exclusion, partial payment balances, shared-profile safeguards, recommendations and protected CSV/Excel/PDF exports.",
    );
  } finally {
    await db.settings.update({
      where: { id: "company" },
      data: { crmEnabled: original.crmEnabled },
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
            { entityId: { in: [categoryId, serviceId, ...customers] } },
            { userId: { in: users } },
          ],
        },
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
      await db.recommendation.deleteMany({
        where: { customerId: { in: customers } },
      });
      await db.consentEvent.deleteMany({
        where: { customerId: { in: customers } },
      });
      await db.vehicle.deleteMany({ where: { customerId: { in: customers } } });
      await db.customerBranch.deleteMany({
        where: { customerId: { in: customers } },
      });
      await db.customer.deleteMany({ where: { id: { in: customers } } });
      await db.branchService.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.attendance.deleteMany({ where: { branchId: { in: branches } } });
      await db.branchStock.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.assignment.deleteMany({ where: { userId: { in: users } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    }
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
