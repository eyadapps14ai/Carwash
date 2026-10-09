import { Prisma } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { assertAccess, canBranch } from "./auth";
import { D, round, dubaiDate, saleTotals, Cost, serviceCost } from "./finance";
import { lockBranch, ensureOpen, businessDate } from "./finance-actions";
import {
  estimatedLineCost,
  weightedStockCost,
  jobTransitions,
  jobStatuses,
  Material,
  JobLine,
} from "./operations";
import { resolveCustomerSelection } from "./crm-actions";
const text = z.string().trim().min(1).max(300),
  id = z.string().min(1).max(100),
  note = z.string().trim().min(1).max(1000),
  money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  qty = z
    .string()
    .regex(/^\d{1,10}(\.\d{1,4})?$/)
    .refine((v) => D(v).gt(0)),
  nonnegative = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/),
  key = z.string().uuid();
type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: string; branches: { branchId: string }[] };
async function activeBranch(tx: Tx, branchId: string) {
  await lockBranch(tx, branchId);
  if (!(await tx.branch.findUniqueOrThrow({ where: { id: branchId } })).active)
    throw new Error("Branch inactive");
  await ensureOpen(tx, branchId, dubaiDate());
}
async function audit(
  tx: Tx,
  u: Actor,
  action: string,
  entityId: string,
  branchId: string | undefined,
  data: unknown,
) {
  await tx.audit.create({
    data: {
      userId: u.id,
      action,
      entityId,
      branchId,
      detail: JSON.parse(JSON.stringify(data)),
    },
  });
}
async function stockRecord(tx: Tx, branchId: string, itemId: string) {
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: { id: itemId },
  });
  if (!item.active) throw new Error("Inventory item inactive");
  return tx.branchStock.upsert({
    where: { branchId_itemId: { branchId, itemId } },
    create: { branchId, itemId },
    update: {},
  });
}
export async function snapshotService(
  tx: Tx,
  branchId: string,
  serviceId: string,
): Promise<JobLine> {
  const c = await tx.branchService.findUniqueOrThrow({
    where: { branchId_serviceId: { branchId, serviceId } },
    include: { service: { include: { category: true } } },
  });
  if (!c.active || !c.service.active || !c.service.category.active)
    throw new Error("Service unavailable");
  const recipes = c.stockMaterials as Material[],
    replaced = new Set(recipes.flatMap((r) => r.replaceCostNames));
  const materials = [];
  for (const r of recipes) {
    const stock = await stockRecord(tx, branchId, r.itemId),
      item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: r.itemId },
      });
    materials.push({
      itemId: r.itemId,
      name: item.name,
      quantity: r.quantity,
      unitCost: stock.unitCost.toString(),
    });
  }
  return {
    serviceId,
    name: c.service.name,
    category: c.service.category.name,
    price: c.price.toFixed(2),
    cost: estimatedLineCost(
      c.price.toString(),
      c.costs as Cost[],
      recipes,
      materials,
    ).toFixed(2),
    costSnapshot: (c.costs as Cost[]).filter((v) => !replaced.has(v.name)),
    materials,
  };
}
export async function consumeLines(
  tx: Tx,
  branchId: string,
  lines: JobLine[],
  reference: string,
  actorId: string,
  link: { jobId?: string; saleId?: string },
) {
  // Branch lock serializes all receipts, transfers and completion consumption.
  const actual: JobLine[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    let cost = serviceCost(line.price, line.costSnapshot);
    const materials = [];
    for (const [materialIndex, m] of line.materials.entries()) {
      const s = await stockRecord(tx, branchId, m.itemId);
      if (D(s.quantity.toString()).lt(m.quantity))
        throw new Error(`Insufficient stock: ${m.name}`);
      const value = round(D(m.quantity).mul(s.unitCost.toString()));
      await tx.branchStock.update({
        where: { branchId_itemId: { branchId, itemId: m.itemId } },
        data: { quantity: { decrement: m.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          requestKey: `${reference}:${lineIndex}:${materialIndex}`,
          branchId,
          itemId: m.itemId,
          quantity: D(m.quantity).negated(),
          unitCost: s.unitCost,
          value: value.negated(),
          kind: "CONSUMPTION",
          reference,
          note: `Completed ${line.name}`,
          actorId,
          ...link,
        },
      });
      cost = cost.plus(value);
      materials.push({ ...m, unitCost: s.unitCost.toString() });
    }
    actual.push({ ...line, cost: round(cost).toFixed(2), materials });
  }
  return actual;
}
export function saleLineData(lines: JobLine[]) {
  return lines.map((l) => ({
    serviceId: l.serviceId,
    name: l.name,
    category: l.category,
    price: l.price,
    cost: l.cost,
    costSnapshot: JSON.parse(
      JSON.stringify([
        ...l.costSnapshot,
        ...l.materials.map((m) => ({
          name: m.name,
          mode: "QUANTITY",
          amount: m.unitCost,
          quantity: m.quantity,
          source: "INVENTORY",
        })),
      ]),
    ),
  }));
}
async function jobAccess(
  tx: Tx,
  u: Actor,
  jobId: string,
  roles = ["OWNER", "MANAGER", "CASHIER", "TECHNICIAN"],
) {
  await tx.$queryRaw`SELECT id FROM "JobCard" WHERE id=${jobId} FOR UPDATE`;
  const job = await tx.jobCard.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      assignments: true,
      quotes: { orderBy: { version: "desc" }, include: { approval: true } },
      times: { where: { endedAt: null } },
    },
  });
  assertAccess(u, roles, job.branchId);
  if (
    u.role === "TECHNICIAN" &&
    !job.assignments.some((a) => a.userId === u.id)
  )
    throw new Error("Job is not assigned to you");
  return job;
}
async function validateWorkers(tx: Tx, branchId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (
    (await tx.user.count({
      where: {
        id: { in: unique },
        active: true,
        branches: { some: { branchId } },
      },
    })) !== unique.length
  )
    throw new Error("Employee inactive or not assigned to branch");
  return unique;
}
export async function operationsAction(
  tx: Tx,
  u: Actor,
  action: string,
  input: unknown,
): Promise<string | undefined> {
  if (action === "inventoryItem") {
    assertAccess(u, ["OWNER"]);
    const v = z
      .object({
        id: id.optional(),
        name: text,
        sku: text,
        category: text,
        unit: text,
        supplier: z.string().max(300),
        active: z.boolean(),
      })
      .parse(input);
    const { id: itemId, ...data } = v;
    const item = itemId
      ? await tx.inventoryItem.update({ where: { id: itemId }, data })
      : await tx.inventoryItem.create({ data });
    await audit(tx, u, action, item.id, undefined, v);
    return item.id;
  }
  if (action === "stockSettings") {
    const v = z
      .object({
        branchId: id,
        itemId: id,
        reorderLevel: nonnegative,
        location: z.string().max(200),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER"], v.branchId);
    await activeBranch(tx, v.branchId);
    await stockRecord(tx, v.branchId, v.itemId);
    await tx.branchStock.update({
      where: { branchId_itemId: { branchId: v.branchId, itemId: v.itemId } },
      data: { reorderLevel: v.reorderLevel, location: v.location },
    });
    await audit(tx, u, action, v.itemId, v.branchId, v);
    return v.itemId;
  }
  if (action === "stockMove") {
    const v = z
      .object({
        branchId: id,
        itemId: id,
        kind: z.enum(["RECEIPT", "ADJUST_IN", "ADJUST_OUT"]),
        quantity: qty,
        unitCost: money,
        requestKey: key,
        note,
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER"], v.branchId);
    await activeBranch(tx, v.branchId);
    const existing = await tx.stockMovement.findUnique({
      where: { requestKey: v.requestKey },
    });
    if (existing) {
      if (existing.branchId !== v.branchId || existing.itemId !== v.itemId)
        throw new Error("Request key already used");
      return existing.id;
    }
    const s = await stockRecord(tx, v.branchId, v.itemId),
      out = v.kind === "ADJUST_OUT";
    if (out && D(s.quantity.toString()).lt(v.quantity))
      throw new Error("Stock cannot be negative");
    const cost = out ? s.unitCost.toString() : v.unitCost,
      newCost = out
        ? s.unitCost
        : weightedStockCost(
            s.quantity.toString(),
            s.unitCost.toString(),
            v.quantity,
            cost,
          );
    await tx.branchStock.update({
      where: { branchId_itemId: { branchId: v.branchId, itemId: v.itemId } },
      data: {
        quantity: out
          ? D(s.quantity.toString()).minus(v.quantity)
          : D(s.quantity.toString()).plus(v.quantity),
        unitCost: newCost,
      },
    });
    const m = await tx.stockMovement.create({
      data: {
        ...v,
        quantity: out ? D(v.quantity).negated() : D(v.quantity),
        unitCost: cost,
        value: round(
          D(v.quantity)
            .mul(cost)
            .mul(out ? -1 : 1),
        ),
        actorId: u.id,
      },
    });
    await audit(tx, u, action, m.id, v.branchId, v);
    return m.id;
  }
  if (action === "stockTransfer") {
    const v = z
      .object({
        fromBranchId: id,
        toBranchId: id,
        itemId: id,
        quantity: qty,
        requestKey: key,
        note,
      })
      .parse(input);
    for (const b of [v.fromBranchId, v.toBranchId])
      assertAccess(u, ["OWNER", "MANAGER"], b);
    if (v.fromBranchId === v.toBranchId)
      throw new Error("Choose different branches");
    for (const b of [v.fromBranchId, v.toBranchId].sort())
      await activeBranch(tx, b);
    const old = await tx.stockMovement.findUnique({
      where: { requestKey: v.requestKey + ":OUT" },
    });
    if (old) {
      if (old.branchId !== v.fromBranchId || old.itemId !== v.itemId)
        throw new Error("Request key already used");
      return old.id;
    }
    const from = await stockRecord(tx, v.fromBranchId, v.itemId),
      to = await stockRecord(tx, v.toBranchId, v.itemId);
    if (D(from.quantity.toString()).lt(v.quantity))
      throw new Error("Insufficient stock for transfer");
    await tx.branchStock.update({
      where: {
        branchId_itemId: { branchId: v.fromBranchId, itemId: v.itemId },
      },
      data: { quantity: { decrement: v.quantity } },
    });
    await tx.branchStock.update({
      where: { branchId_itemId: { branchId: v.toBranchId, itemId: v.itemId } },
      data: {
        quantity: { increment: v.quantity },
        unitCost: weightedStockCost(
          to.quantity.toString(),
          to.unitCost.toString(),
          v.quantity,
          from.unitCost.toString(),
        ),
      },
    });
    let outId = "";
    for (const [b, direction] of [
      [v.fromBranchId, -1],
      [v.toBranchId, 1],
    ] as const) {
      const m = await tx.stockMovement.create({
        data: {
          requestKey: v.requestKey + (direction === -1 ? ":OUT" : ":IN"),
          branchId: b,
          itemId: v.itemId,
          quantity: D(v.quantity).mul(direction),
          unitCost: from.unitCost,
          value: round(
            D(v.quantity).mul(from.unitCost.toString()).mul(direction),
          ),
          kind: direction === -1 ? "TRANSFER_OUT" : "TRANSFER_IN",
          reference: v.requestKey,
          note: v.note,
          actorId: u.id,
        },
      });
      if (direction === -1) outId = m.id;
      await audit(tx, u, action, m.id, b, v);
    }
    return outId;
  }
  if (action === "serviceMaterials") {
    const v = z
      .object({
        branchId: id,
        serviceId: id,
        materials: z
          .array(
            z.object({
              itemId: id,
              quantity: qty,
              replaceCostNames: z.array(text).max(30),
            }),
          )
          .max(30),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER"], v.branchId);
    await activeBranch(tx, v.branchId);
    const c = await tx.branchService.findUniqueOrThrow({
      where: {
        branchId_serviceId: { branchId: v.branchId, serviceId: v.serviceId },
      },
    });
    if (new Set(v.materials.map((m) => m.itemId)).size !== v.materials.length)
      throw new Error("Use one recipe row per item");
    const names = v.materials.flatMap((m) => m.replaceCostNames);
    if (new Set(names).size !== names.length)
      throw new Error("Each estimated cost may be replaced only once");
    for (const name of names)
      if (
        !(c.costs as Cost[]).some(
          (k) => k.name === name && k.source !== "PAYROLL",
        )
      )
        throw new Error("Invalid replaced cost component");
    for (const m of v.materials) await stockRecord(tx, v.branchId, m.itemId);
    await tx.branchService.update({
      where: { id: c.id },
      data: { stockMaterials: v.materials },
    });
    await audit(tx, u, action, c.id, v.branchId, v);
    return c.id;
  }
  if (action === "jobCreate") {
    const v = z
      .object({
        branchId: id,
        requestKey: key,
        customerName: text,
        customerId: id.optional(),
        vehicleId: id.optional(),
        customerPhone: z.string().max(50),
        plate: text,
        vehicle: z.string().max(300),
        requestedWork: note,
        estimatedCompletion: businessDate.optional(),
        workerIds: z.array(id).max(30),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER", "CASHIER"], v.branchId);
    await activeBranch(tx, v.branchId);
    const old = await tx.jobCard.findUnique({
      where: { requestKey: v.requestKey },
    });
    if (old) {
      if (old.branchId !== v.branchId)
        throw new Error("Request key already used");
      return old.id;
    }
    const customerSelection = await resolveCustomerSelection(
      tx,
      u,
      v.branchId,
      v.customerId,
      v.vehicleId,
    );
    const workers = await validateWorkers(tx, v.branchId, v.workerIds);
    const { workerIds, estimatedCompletion, ...data } = v;
    const job = await tx.jobCard.create({
      data: {
        ...data,
        ...customerSelection,
        plate: customerSelection.plate ?? v.plate.toUpperCase(),
        number: `JC-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        estimatedCompletion: estimatedCompletion
          ? new Date(estimatedCompletion + "T12:00:00+04:00")
          : null,
        assignments: { create: workers.map((userId) => ({ userId })) },
        events: {
          create: { status: "NEW", note: v.requestedWork, actorId: u.id },
        },
      },
    });
    await audit(tx, u, action, job.id, job.branchId, v);
    return job.id;
  }
  if (action === "jobAssign") {
    const v = z.object({ id, workerIds: z.array(id).max(30) }).parse(input),
      job = await jobAccess(tx, u, v.id, ["OWNER", "MANAGER"]);
    if (
      ["COMPLETED", "DELIVERED", "CANCELLED"].includes(job.status) ||
      job.times.length
    )
      throw new Error(
        "Cannot change assignments on a finished job or while timers run",
      );
    const workers = await validateWorkers(tx, job.branchId, v.workerIds);
    await tx.jobAssignment.deleteMany({ where: { jobId: job.id } });
    await tx.jobAssignment.createMany({
      data: workers.map((userId) => ({ userId, jobId: job.id })),
    });
    await audit(tx, u, action, job.id, job.branchId, v);
    return job.id;
  }
  if (action === "jobQuote") {
    const v = z
        .object({
          id,
          serviceIds: z.array(id).max(30),
          laborName: text,
          laborCharge: money,
          otherCost: money,
          discount: money,
          parts: z
            .array(z.object({ itemId: id, quantity: qty, sellingPrice: money }))
            .max(30),
        })
        .parse(input),
      job = await jobAccess(tx, u, v.id, ["OWNER", "MANAGER"]);
    await activeBranch(tx, job.branchId);
    if (
      !["NEW", "INSPECTION", "QUOTATION", "AWAITING_APPROVAL"].includes(
        job.status,
      )
    )
      throw new Error("Quotation is locked after work starts");
    if (!v.serviceIds.length && !v.parts.length && !D(v.laborCharge).gt(0))
      throw new Error("Add services, labor, or parts");
    const lines: JobLine[] = [];
    for (const serviceId of v.serviceIds)
      lines.push(await snapshotService(tx, job.branchId, serviceId));
    if (D(v.laborCharge).gt(0) || D(v.otherCost).gt(0))
      lines.push({
        serviceId: "labor",
        name: v.laborName,
        category: "Labor",
        price: v.laborCharge,
        cost: v.otherCost,
        costSnapshot: [
          {
            name: "Other direct labor cost (non-payroll)",
            mode: "FIXED",
            amount: v.otherCost,
            source: "DIRECT",
          },
        ],
        materials: [],
      });
    for (const part of v.parts) {
      const s = await stockRecord(tx, job.branchId, part.itemId),
        item = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: part.itemId },
        });
      lines.push({
        serviceId: `inventory:${item.id}`,
        name: `${item.name} × ${part.quantity}`,
        category: "Spare parts",
        price: part.sellingPrice,
        cost: round(D(part.quantity).mul(s.unitCost.toString())).toFixed(2),
        costSnapshot: [],
        materials: [
          {
            itemId: item.id,
            name: item.name,
            quantity: part.quantity,
            unitCost: s.unitCost.toString(),
          },
        ],
      });
    }
    const settings = await tx.settings.findUniqueOrThrow({
        where: { id: "company" },
      }),
      totals = saleTotals(lines, v.discount, settings.vatRate.toString());
    await tx.quotationRevision.create({
      data: {
        jobId: job.id,
        version: (job.quotes[0]?.version ?? 0) + 1,
        lines: lines as any,
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat: totals.vat,
        total: totals.total,
        vatRate: settings.vatRate,
        createdBy: u.id,
      },
    });
    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        status: "QUOTATION",
        events: {
          create: {
            status: "QUOTATION",
            note: "New quotation revision; previous approval does not apply",
            actorId: u.id,
          },
        },
      },
    });
    await audit(tx, u, action, job.id, job.branchId, v);
    return job.id;
  }
  if (action === "jobApproval") {
    const v = z
        .object({
          id,
          quotationId: id,
          customerName: text,
          method: z.enum(["SIGNED", "EMAIL", "PHONE", "IN_PERSON"]),
          evidence: note,
        })
        .parse(input),
      job = await jobAccess(tx, u, v.id, ["OWNER", "MANAGER", "CASHIER"]);
    if (!["QUOTATION", "AWAITING_APPROVAL"].includes(job.status))
      throw new Error("Job is not awaiting approval");
    const quote = job.quotes[0];
    if (!quote || quote.id !== v.quotationId)
      throw new Error(
        "Quotation changed; refresh and obtain approval for the latest revision",
      );
    if (!quote.approval)
      await tx.quotationApproval.create({
        data: {
          quotationId: quote.id,
          customerName: v.customerName,
          method: v.method,
          evidence: v.evidence,
          recordedBy: u.id,
        },
      });
    await tx.jobCard.update({
      where: { id: job.id },
      data: { status: "AWAITING_APPROVAL" },
    });
    await audit(tx, u, action, job.id, job.branchId, v);
    return job.id;
  }
  if (action === "jobStatus") {
    const v = z.object({ id, status: z.enum(jobStatuses), note }).parse(input),
      job = await jobAccess(tx, u, v.id);
    if (job.status === v.status) return job.id;
    if (!(jobTransitions[job.status] ?? []).includes(v.status))
      throw new Error("Invalid job status transition");
    if (
      u.role === "CASHIER" &&
      !["AWAITING_APPROVAL", "DELIVERED"].includes(v.status)
    )
      throw new Error("Cashier cannot change workshop progress");
    if (
      u.role === "TECHNICIAN" &&
      !["INSPECTION", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED"].includes(
        v.status,
      )
    )
      throw new Error("Technician cannot authorize this status");
    if (
      ["IN_PROGRESS", "COMPLETED"].includes(v.status) &&
      !job.quotes[0]?.approval
    )
      throw new Error("Record customer approval of the latest quotation first");
    if (v.status === "IN_PROGRESS" && !job.assignments.length)
      throw new Error("Assign a technician first");
    if (job.times.length && v.status !== "IN_PROGRESS")
      throw new Error("Stop all job timers before changing status");
    let completionLines: JobLine[] | undefined;
    if (v.status === "COMPLETED") {
      await activeBranch(tx, job.branchId);
      completionLines = await consumeLines(
        tx,
        job.branchId,
        job.quotes[0].lines as unknown as JobLine[],
        job.id,
        u.id,
        { jobId: job.id },
      );
    }
    if (v.status === "DELIVERED" && !job.saleId)
      throw new Error("Generate the completed job invoice before delivery");
    await tx.jobCard.update({
      where: { id: job.id },
      data: {
        status: v.status,
        ...(completionLines
          ? { completionLines: completionLines as any, completedAt: new Date() }
          : {}),
        ...(v.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        events: { create: { status: v.status, note: v.note, actorId: u.id } },
      },
    });
    await audit(tx, u, action, job.id, job.branchId, v);
    return job.id;
  }
  if (action === "jobInvoice") {
    const v = z.object({ id }).parse(input),
      job = await jobAccess(tx, u, v.id, ["OWNER", "MANAGER", "CASHIER"]);
    if (job.saleId) return job.saleId;
    if (job.status !== "COMPLETED" || !job.completionLines)
      throw new Error("Complete the approved job first");
    await activeBranch(tx, job.branchId);
    const q = job.quotes[0],
      lines = job.completionLines as unknown as JobLine[],
      totals = saleTotals(lines, q.discount.toString(), q.vatRate.toString());
    const sale = await tx.sale.create({
      data: {
        number: `PT-JOB-${job.number}`,
        requestKey: `job:${job.id}`,
        branchId: job.branchId,
        cashierId: u.id,
        plate: job.plate,
        customerName: job.customerName,
        customerId: job.customerId,
        vehicleId: job.vehicleId,
        vatRate: q.vatRate,
        ...totals,
        lines: { create: saleLineData(lines) },
        workers: { create: job.assignments.map((a) => ({ userId: a.userId })) },
      },
    });
    await tx.jobCard.update({
      where: { id: job.id },
      data: { saleId: sale.id },
    });
    await audit(tx, u, action, sale.id, job.branchId, v);
    return sale.id;
  }
  if (action === "jobTimeStart") {
    const v = z.object({ id }).parse(input),
      job = await jobAccess(tx, u, v.id, ["OWNER", "MANAGER", "TECHNICIAN"]);
    if (!job.assignments.some((a) => a.userId === u.id))
      throw new Error("Record time only on your assigned jobs");
    if (job.status !== "IN_PROGRESS")
      throw new Error("Job must be in progress");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR UPDATE`;
    if (
      await tx.technicianTime.count({ where: { userId: u.id, endedAt: null } })
    )
      throw new Error("Stop your current job timer first");
    const time = await tx.technicianTime.create({
      data: { userId: u.id, jobId: job.id },
    });
    await audit(tx, u, action, time.id, job.branchId, v);
    return time.id;
  }
  if (action === "jobTimeStop") {
    const v = z.object({ id, note: z.string().max(1000) }).parse(input);
    await tx.$queryRaw`SELECT id FROM "TechnicianTime" WHERE id=${v.id} FOR UPDATE`;
    const time = await tx.technicianTime.findUniqueOrThrow({
      where: { id: v.id },
      include: { job: true },
    });
    assertAccess(u, ["OWNER", "MANAGER", "TECHNICIAN"], time.job.branchId);
    if (
      u.id !== time.userId &&
      (!["OWNER", "MANAGER"].includes(u.role) || !v.note.trim())
    )
      throw new Error(
        "Only the timer owner or an authorized manager with a reason can stop it",
      );
    if (!time.endedAt)
      await tx.technicianTime.update({
        where: { id: time.id },
        data: { endedAt: new Date(), note: v.note },
      });
    await audit(tx, u, action, time.id, time.job.branchId, v);
    return time.id;
  }
  if (action === "attendanceIn") {
    const v = z.object({ branchId: id }).parse(input);
    assertAccess(u, ["OWNER", "MANAGER", "CASHIER", "TECHNICIAN"], v.branchId);
    if (
      !(await tx.settings.findUniqueOrThrow({ where: { id: "company" } }))
        .attendanceEnabled
    )
      throw new Error("Attendance tracking disabled");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR UPDATE`;
    if (await tx.attendance.count({ where: { userId: u.id, endedAt: null } }))
      throw new Error("Already clocked in");
    if (
      !(await tx.branch.findUniqueOrThrow({ where: { id: v.branchId } })).active
    )
      throw new Error("Branch inactive");
    const a = await tx.attendance.create({
      data: { userId: u.id, branchId: v.branchId },
    });
    await audit(tx, u, action, a.id, v.branchId, v);
    return a.id;
  }
  if (action === "attendanceOut") {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR UPDATE`;
    const a = await tx.attendance.findFirst({
      where: { userId: u.id, endedAt: null },
    });
    if (!a) throw new Error("You are not clocked in");
    await tx.attendance.update({
      where: { id: a.id },
      data: { endedAt: new Date() },
    });
    await audit(tx, u, action, a.id, a.branchId, {});
    return a.id;
  }
  if (action === "operationsSettings") {
    assertAccess(u, ["OWNER"]);
    const v = z.object({ attendanceEnabled: z.boolean() }).parse(input);
    await tx.settings.update({ where: { id: "company" }, data: v });
    await audit(tx, u, action, "company", undefined, v);
    return "company";
  }
  if (action === "productivityTarget") {
    const v = z
      .object({ id, target: z.number().int().min(0).max(100000) })
      .parse(input);
    assertAccess(u, ["OWNER"]);
    await tx.user.update({
      where: { id: v.id },
      data: { productivityTarget: v.target },
    });
    await audit(tx, u, action, v.id, undefined, v);
    return v.id;
  }
  return undefined;
}
