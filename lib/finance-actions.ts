import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertAccess } from "./auth";
import { D, dubaiDate } from "./finance";
import {
  buildReport,
  monthStart,
  monthEnd,
  cashAt,
  dateOnly,
} from "./intelligence";
import { loadFinanceData } from "./finance-data";
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  text = z.string().trim().min(1).max(300),
  month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`);
    return (
      value >= "1900-01-01" &&
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === value
    );
  }, "Invalid date");
const toDate = (date: string) => new Date(`${date}T00:00:00+04:00`);
export async function lockBranch(
  tx: Prisma.TransactionClient,
  branchId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} FOR UPDATE`;
}
export async function ensureOpen(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: string,
) {
  const closed = await tx.periodClose.findUnique({
    where: { branchId_month: { branchId, month: date.slice(0, 7) } },
  });
  if (closed)
    throw new Error(
      "This financial month is closed. Its records cannot be changed.",
    );
}
export async function ensureRevisionOpen(
  tx: Prisma.TransactionClient,
  branchId: string,
  effectiveMonth: string,
) {
  const closed = await tx.periodClose.findFirst({
    where: { branchId, month: { gte: effectiveMonth } },
  });
  if (closed)
    throw new Error(
      "Expense revisions must take effect after the latest closed month.",
    );
}
export async function invalidateCashReview(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: string,
) {
  await tx.forecastConfig.updateMany({
    where: { branchId, cashReviewedThrough: { gte: date } },
    data: { cashReviewedThrough: "" },
  });
}
type Actor = { id: string; role: string; branches: { branchId: string }[] };
export async function financeAction(
  tx: Prisma.TransactionClient,
  user: Actor,
  action: string,
  data: unknown,
): Promise<string | undefined> {
  if (
    ![
      "forecastConfig",
      "investment",
      "cashMovement",
      "voidCash",
      "closeMonth",
    ].includes(action)
  )
    return undefined;
  assertAccess(user, ["OWNER"]);
  const audit = async (id: string, branchId: string) =>
    tx.audit.create({
      data: {
        userId: user.id,
        action,
        entityId: id,
        branchId,
        detail: JSON.parse(JSON.stringify(data)),
      },
    });
  if (action === "forecastConfig") {
    const v = z
      .object({
        branchId: text,
        basis: z.enum(["AUTO", "AVERAGE"]),
        conservativePct: amount,
        expectedPct: amount,
        optimisticPct: amount,
        futureCostPct: amount,
        extraExpense: amount,
        revenueTarget: amount,
        profitTarget: amount,
        recoveryMonthlyCash: amount,
        cashReviewedThrough: z.union([businessDate, z.literal("")]).default(""),
      })
      .parse(data);
    assertAccess(user, ["OWNER"], v.branchId);
    await lockBranch(tx, v.branchId);
    for (const key of [
      "conservativePct",
      "expectedPct",
      "optimisticPct",
      "futureCostPct",
    ] as const)
      if (D(v[key]).gt(500))
        throw new Error("Scenario percentages must be between 0 and 500");
    if (
      D(v.conservativePct).gt(v.expectedPct) ||
      D(v.expectedPct).gt(v.optimisticPct)
    )
      throw new Error(
        "Scenario multipliers must be ordered conservative ≤ expected ≤ optimistic",
      );
    if (v.cashReviewedThrough > dubaiDate())
      throw new Error("Cash review cannot be future-dated");
    await tx.forecastConfig.upsert({
      where: { branchId: v.branchId },
      create: v,
      update: v,
    });
    await audit(v.branchId, v.branchId);
    return v.branchId;
  }
  if (action === "investment") {
    const v = z
      .object({
        id: z.string().optional(),
        requestKey: z.string().uuid(),
        branchId: text,
        category: z.enum([
          "Equipment",
          "Renovation",
          "Machinery",
          "Initial setup",
          "Other",
          "Refundable deposit",
        ]),
        description: text,
        amount,
        date: businessDate,
        kind: z.enum(["CAPITAL", "DEPOSIT"]),
        paid: z.boolean().default(false),
      })
      .parse(data);
    if (D(v.amount).lte(0))
      throw new Error("Investment amount must be positive");
    if (v.date > dubaiDate())
      throw new Error(
        "Use an actual acquisition date; future plans belong in assumptions",
      );
    if (
      (v.kind === "DEPOSIT" && v.category !== "Refundable deposit") ||
      (v.kind === "CAPITAL" && v.category === "Refundable deposit")
    )
      throw new Error(
        "Deposits must be recorded separately from capital investment",
      );
    await lockBranch(tx, v.branchId);
    await ensureOpen(tx, v.branchId, v.date);
    if (!v.id) {
      const existing = await tx.investment.findUnique({
        where: { requestKey: v.requestKey },
      });
      if (existing) return existing.id;
    }
    if (v.id) {
      const old = await tx.investment.findUniqueOrThrow({
        where: { id: v.id },
        include: { movements: true },
      });
      if (old.branchId !== v.branchId || old.kind !== v.kind)
        throw new Error("Investment branch and type cannot be changed");
      await ensureOpen(tx, v.branchId, dateOnly(old.date.toISOString()));
      const posted = old.movements
        .filter((m) => !m.voidedAt && m.direction === "OUT")
        .reduce((n, m) => n.plus(m.amount.toString()), D(0));
      if (D(v.amount).lt(posted))
        throw new Error("Amount cannot be lower than historical payments");
      if (old.movements.some((m) => dateOnly(m.date.toISOString()) < v.date))
        throw new Error(
          "Acquisition date cannot be later than existing payments",
        );
    }
    const { id, requestKey, paid, ...profile } = v;
    const investment = id
      ? await tx.investment.update({
          where: { id },
          data: { ...profile, date: toDate(v.date) },
        })
      : await tx.investment.create({
          data: { ...profile, requestKey, date: toDate(v.date) },
        });
    if (paid && !id)
      await tx.cashMovement.create({
        data: {
          requestKey: `${requestKey}-initial`,
          branchId: v.branchId,
          investmentId: investment.id,
          amount: v.amount,
          date: toDate(v.date),
          direction: "OUT",
          category: v.kind,
          description: `Acquisition payment: ${v.description}`,
        },
      });
    await invalidateCashReview(tx, v.branchId, v.date);
    await audit(investment.id, v.branchId);
    return investment.id;
  }
  if (action === "cashMovement") {
    const v = z
      .object({
        requestKey: z.string().uuid(),
        branchId: text,
        investmentId: z.string().optional(),
        expenseId: z.string().optional(),
        amount,
        date: businessDate,
        direction: z.enum(["IN", "OUT"]),
        category: z.enum([
          "OPERATING",
          "TAX",
          "OTHER",
          "FINANCING",
          "CAPITAL",
          "DEPOSIT",
        ]),
        description: text,
      })
      .parse(data);
    if (D(v.amount).lte(0)) throw new Error("Cash movement must be positive");
    if (v.date > dubaiDate())
      throw new Error(
        "Cash journal accepts recorded payments, not future cash forecasts",
      );
    await lockBranch(tx, v.branchId);
    await ensureOpen(tx, v.branchId, v.date);
    const existing = await tx.cashMovement.findUnique({
      where: { requestKey: v.requestKey },
    });
    if (existing) return existing.id;
    if (["CAPITAL", "DEPOSIT"].includes(v.category)) {
      if (!v.investmentId)
        throw new Error("Select the matching investment or deposit");
      const investment = await tx.investment.findUniqueOrThrow({
        where: { id: v.investmentId },
        include: { movements: true },
      });
      if (investment.branchId !== v.branchId || investment.kind !== v.category)
        throw new Error("Investment type or branch does not match");
      if (v.date < dateOnly(investment.date.toISOString()))
        throw new Error("Payment cannot predate acquisition");
      const movements = investment.movements.filter((m) => !m.voidedAt),
        paid = movements.reduce(
          (n, m) =>
            m.direction === "OUT"
              ? n.plus(m.amount.toString())
              : n.minus(m.amount.toString()),
          D(0),
        );
      if (
        v.direction === "OUT" &&
        paid.plus(v.amount).gt(investment.amount.toString())
      )
        throw new Error(
          "Payment exceeds remaining investment/deposit commitment",
        );
      if (v.direction === "IN" && D(v.amount).gt(paid))
        throw new Error("Return cannot exceed paid capital/deposit");
    } else if (v.investmentId)
      throw new Error(
        "Only capital and deposit movements can link to investments",
      );
    if (v.expenseId) {
      const expense = await tx.expense.findUniqueOrThrow({
        where: { id: v.expenseId },
      });
      if (
        expense.branchId !== v.branchId ||
        !["OPERATING", "TAX", "OTHER"].includes(v.category)
      )
        throw new Error(
          "Expense reference does not match this branch/category",
        );
    }
    const movement = await tx.cashMovement.create({
      data: {
        ...v,
        date: toDate(v.date),
        investmentId: v.investmentId || null,
        expenseId: v.expenseId || null,
      },
    });
    await invalidateCashReview(tx, v.branchId, v.date);
    await audit(movement.id, v.branchId);
    return movement.id;
  }
  if (action === "voidCash") {
    const v = z.object({ id: text, reason: text }).parse(data);
    const movement = await tx.cashMovement.findUniqueOrThrow({
      where: { id: v.id },
    });
    await lockBranch(tx, movement.branchId);
    await ensureOpen(
      tx,
      movement.branchId,
      dateOnly(movement.date.toISOString()),
    );
    if (movement.voidedAt) throw new Error("Movement is already voided");
    if (movement.investmentId) {
      const linked = await tx.cashMovement.findMany({
        where: {
          investmentId: movement.investmentId,
          voidedAt: null,
          id: { not: movement.id },
        },
      });
      const net = linked.reduce(
        (n, m) =>
          m.direction === "OUT"
            ? n.plus(m.amount.toString())
            : n.minus(m.amount.toString()),
        D(0),
      );
      const inv = await tx.investment.findUniqueOrThrow({
        where: { id: movement.investmentId },
      });
      if (net.lt(0) || net.gt(inv.amount.toString()))
        throw new Error(
          "Void would invalidate the remaining investment/deposit payments",
        );
    }
    await tx.cashMovement.update({
      where: { id: v.id },
      data: { voidedAt: new Date() },
    });
    await invalidateCashReview(
      tx,
      movement.branchId,
      dateOnly(movement.date.toISOString()),
    );
    await audit(v.id, movement.branchId);
    return v.id;
  }
  if (action === "closeMonth") {
    const v = z.object({ branchId: text, month }).parse(data);
    if (v.month < "1900-01")
      throw new Error("Choose a business month from 1900 onward");
    if (v.month >= dubaiDate().slice(0, 7))
      throw new Error("Only completed calendar months can be closed");
    await lockBranch(tx, v.branchId);
    const existing = await tx.periodClose.findUnique({
      where: { branchId_month: v },
    });
    if (existing) return existing.id;
    const config = await tx.forecastConfig.findUnique({
      where: { branchId: v.branchId },
    });
    if (!config || config.cashReviewedThrough < monthEnd(v.month))
      throw new Error(
        "Reconcile the cash journal through month end in assumptions before closing",
      );
    const source = await loadFinanceData([v.branchId], tx);
    const report = buildReport(
      source,
      {
        branchIds: [v.branchId],
        start: monthStart(v.month),
        end: monthEnd(v.month),
      },
      false,
    );
    report.closed = true;
    const close = await tx.periodClose.create({
      data: {
        ...v,
        closedBy: user.id,
        snapshot: JSON.parse(JSON.stringify(report)),
      },
    });
    await audit(close.id, v.branchId);
    return close.id;
  }
}
