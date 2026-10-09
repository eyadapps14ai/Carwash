import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { loadOperationsData } from "@/lib/operations-data";
import { loadCRMData } from "@/lib/crm-data";
import Workspace from "./workspace";
import { loadFinanceData } from "@/lib/finance-data";
import { loadMarketingData } from "@/lib/marketing-data";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user)
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brandmark">P</span>
            <div>
              PROTUNE<small>AUTO SERVICES</small>
            </div>
          </div>
          <h1>
            Your business.
            <br />
            In clear view.
          </h1>
          <p>
            Sign in to manage your branches, operations, and financial
            performance.
          </p>
          <form action="/api/login" method="post">
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button>Sign in →</button>
          </form>
          <p className="error">{(await searchParams).error}</p>
          <small>Secure access · Dubai, UAE · Phase 6</small>
        </div>
      </main>
    );
  const scope =
    user.role === "OWNER"
      ? {}
      : { id: { in: user.branches.map((b) => b.branchId) } };
  const branchIds = (await db.branch.findMany({ where: scope })).map(
    (b) => b.id,
  );
  const finance = ["OWNER", "MANAGER"].includes(user.role),
    commercial = user.role !== "TECHNICIAN";
  const [
    branches,
    categories,
    services,
    staff,
    sales,
    expenses,
    expenseCategories,
    settings,
    audits,
    intelligence,
    operations,
    crm,
    marketing,
  ] = await Promise.all([
    db.branch.findMany({ where: scope, orderBy: { name: "asc" } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.service.findMany({
      select: {
        id: true,
        name: true,
        categoryId: true,
        active: true,
        duration: true,
        labor: true,
        materials: true,
        category: true,
        branches: {
          where: { branchId: { in: branchIds } },
          select: {
            id: true,
            branchId: true,
            serviceId: true,
            price: commercial,
            costs: finance,
            active: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where:
        user.role === "OWNER"
          ? {}
          : { branches: { some: { branchId: { in: branchIds } } } },
      select: {
        id: true,
        name: true,
        email: finance,
        role: true,
        title: true,
        salary: finance,
        schedule: true,
        active: true,
        branches: true,
      },
      orderBy: { name: "asc" },
    }),
    db.sale.findMany({
      where: {
        branchId: { in: branchIds },
        ...(user.role === "TECHNICIAN"
          ? { workers: { some: { userId: user.id } } }
          : {}),
      },
      select: {
        id: true,
        number: commercial,
        branchId: true,
        createdAt: true,
        plate: true,
        customerName: commercial,
        subtotal: commercial,
        discount: commercial,
        net: commercial,
        vat: commercial,
        total: commercial,
        cost: finance,
        vatRate: commercial,
        status: true,
        sample: true,
        lines: {
          select: {
            id: true,
            serviceId: true,
            name: true,
            category: true,
            price: commercial,
            cost: finance,
            costSnapshot: finance,
          },
        },
        payments: commercial
          ? {
              select: { id: true, amount: true, method: true, createdAt: true },
            }
          : false,
        workers: {
          select: { userId: true, user: { select: { id: true, name: true } } },
        },
        cashier: commercial ? { select: { name: true } } : false,
      },
      orderBy: { createdAt: "desc" },
    }),
    finance
      ? db.expense.findMany({
          where: { branchId: { in: branchIds } },
          orderBy: { date: "desc" },
        })
      : [],
    db.expenseCategory.findMany(),
    db.settings.findUniqueOrThrow({ where: { id: "company" } }),
    finance
      ? db.audit.findMany({
          where: {
            ...(user.role === "OWNER" ? {} : { branchId: { in: branchIds } }),
          },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [],
    finance ? loadFinanceData(branchIds) : null,
    loadOperationsData(user, branchIds),
    loadCRMData(user, branchIds),
    loadMarketingData(user, branchIds),
  ]);
  // Never serialize authentication secrets. Cost information is restricted to financial roles.
  const safeSales = sales.map((s) => ({
    ...s,
    ...(!finance ? { cost: 0 } : {}),
    lines: s.lines.map((l) => ({
      ...l,
      ...(!finance ? { cost: 0, costSnapshot: [] } : {}),
    })),
  }));
  const safeServices = services.map((s) => ({
    ...s,
    branches: s.branches.map((b) => ({
      estimatedCost: finance
        ? intelligence?.services
            .find((x) => x.id === s.id)
            ?.branches.find((x) => x.branchId === b.branchId)?.costs
        : undefined,
      ...b,
      ...(!finance ? { costs: [] } : {}),
    })),
  }));
  const payload = JSON.parse(
    JSON.stringify({
      user: { id: user.id, name: user.name, role: user.role },
      branches,
      categories,
      services: user.role === "TECHNICIAN" ? [] : safeServices,
      staff: user.role === "TECHNICIAN" ? [] : staff,
      sales:
        user.role === "TECHNICIAN"
          ? safeSales.map((s) => ({
              id: s.id,
              branchId: s.branchId,
              plate: s.plate,
              createdAt: s.createdAt,
              status: s.status,
              lines: s.lines.map((l) => ({ name: l.name })),
              workers: s.workers,
            }))
          : safeSales,
      expenses,
      expenseCategories,
      settings,
      audits,
      intelligence,
      operations,
      crm,
      marketing,
    }),
  );
  return <Workspace data={payload} />;
}
