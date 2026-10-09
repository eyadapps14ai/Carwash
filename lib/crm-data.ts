import { db } from "./db";
import { canBranch } from "./auth";
import { customerStats } from "./crm";
import { dubaiDate } from "./finance";
export async function loadCRMData(
  user: { id: string; role: string; branches: { branchId: string }[] },
  branchIds: string[],
) {
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.crmEnabled || user.role === "TECHNICIAN")
    return {
      enabled: settings.crmEnabled,
      customers: [],
      unlinkedSales: [],
      unlinkedJobs: [],
    };
  const finance = ["OWNER", "MANAGER"].includes(user.role),
    where = { branchId: { in: branchIds } };
  const customers = await db.customer.findMany({
    where: { branches: { some: where } },
    include: {
      branches: true,
      vehicles: { orderBy: { plate: "asc" } },
      sales: {
        where,
        select: {
          id: true,
          number: true,
          branchId: true,
          vehicleId: true,
          createdAt: true,
          plate: true,
          customerName: true,
          net: true,
          vat: true,
          total: true,
          status: true,
          sample: true,
          lines: { select: { name: true, category: true, price: true } },
          payments: { select: { amount: true, createdAt: true, method: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      jobs: {
        where,
        select: {
          id: true,
          number: true,
          branchId: true,
          vehicleId: true,
          status: true,
          plate: true,
          requestedWork: true,
          createdAt: true,
          completedAt: true,
          saleId: true,
          sample: true,
        },
        orderBy: { createdAt: "desc" },
      },
      consentEvents: finance
        ? { orderBy: { createdAt: "desc" }, take: 30 }
        : false,
      recommendations: finance ? { where, orderBy: { dueDate: "asc" } } : false,
    },
    orderBy: { name: "asc" },
  });
  const [unlinkedSales, unlinkedJobs] = finance
    ? await Promise.all([
        db.sale.findMany({
          where: { ...where, customerId: null },
          select: {
            id: true,
            number: true,
            branchId: true,
            plate: true,
            customerName: true,
            createdAt: true,
            status: true,
            sample: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        db.jobCard.findMany({
          where: { ...where, customerId: null },
          select: {
            id: true,
            number: true,
            branchId: true,
            plate: true,
            customerName: true,
            createdAt: true,
            status: true,
            sample: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], []];
  return JSON.parse(
    JSON.stringify({
      enabled: true,
      customers: customers.map((c) => ({
        ...c,
        notes: finance ? c.notes : undefined,
        canEdit:
          finance && c.branches.every((b) => canBranch(user, b.branchId)),
        branches: c.branches
          .filter((b) => canBranch(user, b.branchId))
          .map((b) => ({ branchId: b.branchId })),
        ...customerStats(JSON.parse(JSON.stringify(c.sales))),
      })),
      unlinkedSales,
      unlinkedJobs,
    }),
  );
}
export { customerReportRows } from "./crm";
