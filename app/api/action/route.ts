import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  currentUser,
  assertAccess,
  sameOrigin,
  hashPassword,
} from "@/lib/auth";
import { serviceCost, saleTotals, D, Cost, dubaiDate } from "@/lib/finance";
import {
  financeAction,
  lockBranch,
  ensureOpen,
  ensureRevisionOpen,
  invalidateCashReview,
  businessDate,
} from "@/lib/finance-actions";
import {
  operationsAction,
  snapshotService,
  consumeLines,
  saleLineData,
} from "@/lib/operations-actions";
import { crmAction, resolveCustomerSelection } from "@/lib/crm-actions";
import { marketingAction } from "@/lib/marketing-actions";
import {
  marketingLock,
  resolveVoucher,
  redeemVoucher,
  evaluateCustomer,
} from "@/lib/marketing-engine";
import {
  boundedJSON,
  RequestError,
  isDatabaseError,
} from "@/lib/request-security";
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const text = z.string().trim().min(1).max(200);
const costsSchema = z
  .array(
    z.object({
      name: text,
      mode: z.enum(["FIXED", "PERCENT", "QUANTITY"]),
      amount,
      quantity: amount.optional(),
      source: z.enum(["DIRECT", "PAYROLL"]).default("DIRECT"),
    }),
  )
  .max(30);
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const body = await boundedJSON(req),
      action = body.action,
      data = body.data;
    const result = await db.$transaction(
      async (tx) => {
        const audit = async (entityId: string, branchId?: string) =>
          tx.audit.create({
            data: {
              userId: user.id,
              action,
              entityId,
              branchId,
              detail:
                action === "user"
                  ? { email: data.email, role: data.role }
                  : JSON.parse(JSON.stringify(data)),
            },
          });
        if (["sale", "payment", "cancel"].includes(action))
          await marketingLock(tx);
        const marketingResult = await marketingAction(tx, user, action, data);
        if (marketingResult !== undefined) return marketingResult;
        const customerResult = await crmAction(tx, user, action, data);
        if (customerResult !== undefined) return customerResult;
        const operationalResult = await operationsAction(
          tx,
          user,
          action,
          data,
        );
        if (operationalResult !== undefined) return operationalResult;
        const financialResult = await financeAction(tx, user, action, data);
        if (financialResult !== undefined) return financialResult;
        if (action === "removeService" || action === "removeCategory") {
          assertAccess(user, ["OWNER"]);
          const v = z.object({ id: text }).parse(data);
          if (action === "removeService") {
            if (
              (await tx.saleLine.count({ where: { serviceId: v.id } })) ||
              (
                await tx.quotationRevision.findMany({ select: { lines: true } })
              ).some((q) =>
                (q.lines as any[]).some((l) => l.serviceId === v.id),
              )
            )
              throw new Error(
                "This service has transaction history. Deactivate it to preserve records.",
              );
            await tx.branchService.deleteMany({ where: { serviceId: v.id } });
            await tx.service.delete({ where: { id: v.id } });
          } else {
            if (await tx.service.count({ where: { categoryId: v.id } }))
              throw new Error(
                "This category contains services. Move or deactivate them first.",
              );
            await tx.category.delete({ where: { id: v.id } });
          }
          await audit(v.id);
          return v.id;
        }
        if (action === "branch") {
          assertAccess(user, ["OWNER"]);
          const v = z
            .object({
              id: z.string().optional(),
              name: text,
              code: text,
              active: z.boolean(),
            })
            .parse(data);
          const b = v.id
            ? await tx.branch.update({
                where: { id: v.id },
                data: { name: v.name, code: v.code, active: v.active },
              })
            : await tx.branch.create({ data: v });
          await audit(b.id, b.id);
          return b.id;
        }
        if (action === "category" || action === "expenseCategory") {
          assertAccess(user, ["OWNER"]);
          const v = z
            .object({
              id: z.string().optional(),
              name: text,
              active: z.boolean().optional(),
            })
            .parse(data);
          if (action === "category") {
            const c = v.id
              ? await tx.category.update({
                  where: { id: v.id },
                  data: { name: v.name, active: v.active },
                })
              : await tx.category.create({ data: { name: v.name } });
            await audit(c.id);
            return c.id;
          }
          const c = await tx.expenseCategory.create({ data: { name: v.name } });
          await audit(c.id);
          return c.id;
        }
        if (action === "user") {
          assertAccess(user, ["OWNER"]);
          const v = z
            .object({
              id: z.string().optional(),
              name: text,
              email: z.string().email(),
              password: z.string().max(256),
              role: z.enum(["OWNER", "MANAGER", "CASHIER", "TECHNICIAN"]),
              title: z.string().max(200),
              salary: amount,
              schedule: text,
              active: z.boolean(),
              branchIds: z.array(z.string()).min(1),
            })
            .parse(data);
          if (
            (!v.id && v.password.length < 12) ||
            (v.password && v.password.length < 12)
          )
            throw new Error("Use a unique password of at least 12 characters");
          if (v.id === user.id && (!v.active || v.role !== "OWNER"))
            throw new Error(
              "You cannot deactivate or demote your own owner account",
            );
          const branches = await tx.branch.count({
            where: { id: { in: v.branchIds } },
          });
          if (branches !== new Set(v.branchIds).size)
            throw new Error("Invalid branches");
          const { id, password, branchIds, ...profile } = v;
          const u = id
            ? await tx.user.update({
                where: { id },
                data: {
                  ...profile,
                  email: v.email.toLowerCase(),
                  ...(password ? { passwordHash: hashPassword(password) } : {}),
                },
              })
            : await tx.user.create({
                data: {
                  ...profile,
                  email: v.email.toLowerCase(),
                  passwordHash: hashPassword(password),
                },
              });
          await tx.assignment.deleteMany({ where: { userId: u.id } });
          await tx.assignment.createMany({
            data: [...new Set(branchIds)].map((branchId) => ({
              branchId,
              userId: u.id,
            })),
          });
          if (id) await tx.session.deleteMany({ where: { userId: id } });
          await audit(u.id);
          return u.id;
        }
        if (action === "service") {
          assertAccess(user, ["OWNER"]);
          const v = z
            .object({
              id: z.string().optional(),
              name: text,
              categoryId: text,
              duration: z.number().int().min(1).max(10000),
              labor: z.number().int().min(1).max(50),
              materials: z.string().max(1000),
              active: z.boolean(),
              prices: z
                .array(
                  z.object({
                    branchId: text,
                    price: amount,
                    active: z.boolean(),
                    costs: costsSchema,
                  }),
                )
                .min(1),
            })
            .parse(data);
          const { prices, id, ...profile } = v;
          const s = id
            ? await tx.service.update({ where: { id }, data: profile })
            : await tx.service.create({ data: profile });
          for (const p of prices) {
            await lockBranch(tx, p.branchId);
            const current = await tx.branchService.findUnique({
              where: {
                branchId_serviceId: { branchId: p.branchId, serviceId: s.id },
              },
            });
            const replacementNames = (
              (current?.stockMaterials as any[]) ?? []
            ).flatMap((m) => m.replaceCostNames);
            if (
              replacementNames.some(
                (name) =>
                  !p.costs.some(
                    (c) => c.name === name && c.source !== "PAYROLL",
                  ),
              )
            )
              throw new Error(
                "Update the stock recipe before removing or reclassifying a replaced estimate.",
              );
            serviceCost(p.price, p.costs);
            await tx.branchService.upsert({
              where: {
                branchId_serviceId: { branchId: p.branchId, serviceId: s.id },
              },
              create: { ...p, serviceId: s.id },
              update: { price: p.price, costs: p.costs, active: p.active },
            });
          }
          await audit(s.id);
          return s.id;
        }
        if (action === "expense") {
          const v = z
            .object({
              id: z.string().optional(),
              branchId: text,
              category: text,
              description: text,
              amount,
              date: businessDate,
              effectiveMonth: z
                .string()
                .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
                .optional(),
              frequency: z.enum(["ONCE", "MONTHLY", "ANNUAL"]),
              kind: z.enum(["FIXED", "VARIABLE", "OTHER", "TAX"]),
              active: z.boolean(),
            })
            .parse(data);
          assertAccess(user, ["OWNER", "MANAGER"], v.branchId);
          await lockBranch(tx, v.branchId);
          const effectiveMonth =
            v.effectiveMonth ??
            (v.id ? dubaiDate().slice(0, 7) : v.date.slice(0, 7));
          if (effectiveMonth < v.date.slice(0, 7))
            throw new Error(
              "Revision cannot take effect before the expense starts",
            );
          await ensureRevisionOpen(tx, v.branchId, effectiveMonth);
          if (v.id) {
            const old = await tx.expense.findUniqueOrThrow({
              where: { id: v.id },
              include: { revisions: true },
            });
            assertAccess(user, ["OWNER", "MANAGER"], old.branchId);
            if (old.branchId !== v.branchId)
              throw new Error(
                "Expense branch cannot be changed; create a new branch expense",
              );
            if (
              old.frequency === "ONCE" &&
              dubaiDate(old.date).slice(0, 7) !== v.date.slice(0, 7)
            )
              throw new Error(
                "One-time expense month cannot be moved; create a separate adjustment",
              );
            if (!old.revisions.length)
              await tx.expenseRevision.create({
                data: {
                  expenseId: old.id,
                  effectiveMonth: dubaiDate(old.date).slice(0, 7),
                  category: old.category,
                  description: old.description,
                  amount: old.amount,
                  date: old.date,
                  frequency: old.frequency,
                  kind: old.kind,
                  active: old.active,
                },
              });
          }
          const b = await tx.branch.findUniqueOrThrow({
            where: { id: v.branchId },
          });
          if (!b.active) throw new Error("Branch inactive");
          const { id, effectiveMonth: unused, ...rest } = v;
          const profile = {
            ...rest,
            date: new Date(`${v.date}T00:00:00+04:00`),
          };
          const e = id
            ? await tx.expense.update({ where: { id }, data: profile })
            : await tx.expense.create({ data: profile });
          await tx.expenseRevision.create({
            data: {
              expenseId: e.id,
              effectiveMonth,
              category: v.category,
              description: v.description,
              amount: v.amount,
              date: profile.date,
              frequency: v.frequency,
              kind: v.kind,
              active: v.active,
            },
          });
          await audit(e.id, e.branchId);
          return e.id;
        }
        if (action === "sale") {
          const v = z
            .object({
              branchId: text,
              requestKey: z.string().uuid(),
              serviceIds: z.array(text).min(1).max(30),
              workerIds: z.array(text).max(20),
              plate: text,
              customerName: z.string().max(200),
              customerId: z.string().min(1).max(100).optional(),
              vehicleId: z.string().min(1).max(100).optional(),
              discount: amount,
              voucherCode: z.string().trim().max(80).optional(),
              paid: amount,
              method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
            })
            .parse(data);
          assertAccess(user, ["OWNER", "MANAGER", "CASHIER"], v.branchId);
          if (user.role === "CASHIER" && D(v.discount).gt(0))
            throw new Error(
              "Manager or owner authorization is required for discounts",
            );
          const existing = await tx.sale.findUnique({
            where: { requestKey: v.requestKey },
          });
          if (existing) {
            assertAccess(
              user,
              ["OWNER", "MANAGER", "CASHIER"],
              existing.branchId,
            );
            return existing.id;
          }
          await lockBranch(tx, v.branchId);
          await ensureOpen(tx, v.branchId, dubaiDate());
          const branch = await tx.branch.findUniqueOrThrow({
            where: { id: v.branchId },
          });
          if (!branch.active) throw new Error("Branch inactive");
          const customerSelection = await resolveCustomerSelection(
            tx,
            user,
            v.branchId,
            v.customerId,
            v.vehicleId,
          );
          const configs = await tx.branchService.findMany({
            where: {
              branchId: v.branchId,
              serviceId: { in: v.serviceIds },
              active: true,
              service: { active: true, category: { active: true } },
            },
            include: { service: { include: { category: true } } },
          });
          const snapshotLines = [];
          for (const serviceId of v.serviceIds)
            snapshotLines.push(
              await snapshotService(tx, v.branchId, serviceId),
            );
          const consumed = await consumeLines(
            tx,
            v.branchId,
            snapshotLines,
            v.requestKey,
            user.id,
            {},
          );
          const lines = saleLineData(consumed);
          const workerIds = [...new Set(v.workerIds)];
          const workers = await tx.user.findMany({
            where: {
              id: { in: workerIds },
              active: true,
              branches: { some: { branchId: v.branchId } },
            },
          });
          if (workers.length !== workerIds.length)
            throw new Error("Employee not assigned to this branch");
          const settings = await tx.settings.findUniqueOrThrow({
            where: { id: "company" },
          });
          if (v.voucherCode && D(v.discount).gt(0))
            throw new Error("Voucher and manual discounts cannot be combined");
          const voucher = await resolveVoucher(
            tx,
            v.voucherCode,
            v.customerId,
            v.branchId,
            lines,
            v.requestKey,
          );
          const totals = saleTotals(
            lines.map((l) => ({ price: l.price.toString(), cost: l.cost })),
            voucher?.discount ?? v.discount,
            settings.vatRate.toString(),
          );
          if (D(v.paid).gt(totals.total))
            throw new Error("Payment exceeds invoice total");
          const s = await tx.sale.create({
            data: {
              number: `PT-${Date.now()}-${v.requestKey.slice(0, 6).toUpperCase()}`,
              requestKey: v.requestKey,
              branchId: v.branchId,
              cashierId: user.id,
              plate: customerSelection.plate ?? v.plate.toUpperCase(),
              customerName: customerSelection.customerName ?? v.customerName,
              customerId: customerSelection.customerId,
              vehicleId: customerSelection.vehicleId,
              ...totals,
              vatRate: settings.vatRate,
              lines: { create: lines },
              workers: { create: workerIds.map((userId) => ({ userId })) },
              payments: {
                create: D(v.paid).gt(0)
                  ? [
                      {
                        amount: v.paid,
                        method: v.method,
                        requestKey: v.requestKey,
                      },
                    ]
                  : [],
              },
            },
          });
          if (voucher) await redeemVoucher(tx, voucher, s.id);
          if (s.customerId) await evaluateCustomer(tx, s.customerId);
          await tx.stockMovement.updateMany({
            where: { reference: v.requestKey, branchId: v.branchId },
            data: { saleId: s.id },
          });
          if (D(v.paid).gt(0))
            await invalidateCashReview(tx, s.branchId, dubaiDate());
          await audit(s.id, s.branchId);
          return s.id;
        }
        if (action === "payment") {
          const v = z
            .object({
              id: text,
              amount,
              method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
              requestKey: z.string().uuid(),
            })
            .parse(data);
          // Serialize payments on the invoice to prevent simultaneous overpayment.
          await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${v.id} FOR UPDATE`;
          const s = await tx.sale.findUniqueOrThrow({
            where: { id: v.id },
            include: { payments: true },
          });
          assertAccess(user, ["OWNER", "MANAGER", "CASHIER"], s.branchId);
          await lockBranch(tx, s.branchId);
          await ensureOpen(tx, s.branchId, dubaiDate());
          if (s.status !== "COMPLETED") throw new Error("Invoice cancelled");
          const existing = await tx.payment.findUnique({
            where: { requestKey: v.requestKey },
          });
          if (existing) return s.id;
          const paid = s.payments.reduce(
            (a, p) => a.plus(p.amount.toString()),
            D(0),
          );
          if (D(v.amount).lte(0) || paid.plus(v.amount).gt(s.total.toString()))
            throw new Error(
              "Payment must be positive and no more than the balance",
            );
          await tx.payment.create({
            data: {
              saleId: s.id,
              amount: v.amount,
              method: v.method,
              requestKey: v.requestKey,
            },
          });
          if (s.customerId) await evaluateCustomer(tx, s.customerId);
          await invalidateCashReview(tx, s.branchId, dubaiDate());
          await audit(s.id, s.branchId);
          return s.id;
        }
        if (action === "cancel") {
          const v = z.object({ id: text, reason: text }).parse(data);
          await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${v.id} FOR UPDATE`;
          const s = await tx.sale.findUniqueOrThrow({
            where: { id: v.id },
            include: { payments: true },
          });
          assertAccess(user, ["OWNER", "MANAGER"], s.branchId);
          await lockBranch(tx, s.branchId);
          await ensureOpen(tx, s.branchId, dubaiDate(s.createdAt));
          if (s.status !== "COMPLETED") throw new Error("Already cancelled");
          if (
            (await tx.stockMovement.count({ where: { saleId: s.id } })) ||
            (await tx.jobCard.count({ where: { saleId: s.id } }))
          )
            throw new Error(
              "Invoices with consumed stock or completed job cards require an authorized return/refund workflow; cancellation is unavailable.",
            );
          if (s.payments.length)
            throw new Error(
              "Paid invoices require a refund workflow in a later phase; cancellation is limited to unpaid invoices",
            );
          const redemption = await tx.voucherRedemption.findUnique({
            where: { saleId: s.id },
          });
          if (redemption) {
            await tx.voucherRedemption.update({
              where: { id: redemption.id },
              data: { voidedAt: new Date() },
            });
            await tx.voucher.update({
              where: { id: redemption.voucherId },
              data: { status: "VOID" },
            });
          }
          await tx.sale.update({
            where: { id: s.id },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });
          await audit(s.id, s.branchId);
          return s.id;
        }
        if (action === "settings") {
          assertAccess(user, ["OWNER"]);
          const v = z
            .object({
              vatRate: amount,
              companyName: text,
              trn: z.string().max(30),
            })
            .parse(data);
          if (D(v.vatRate).gt(100)) throw new Error("Invalid VAT rate");
          await tx.settings.update({ where: { id: "company" }, data: v });
          await audit("company");
          return "company";
        }
        throw new Error("Unknown action");
      },
      { timeout: 60000 },
    );
    return NextResponse.json({ id: result });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Check the fields and monetary amounts"
        : isDatabaseError(error)
          ? "Record conflict or invalid reference. Refresh and try again."
          : error instanceof Error
            ? error.message
            : "Operation failed";
    return NextResponse.json(
      { error: message },
      { status: error instanceof RequestError ? error.status : 400 },
    );
  }
}
