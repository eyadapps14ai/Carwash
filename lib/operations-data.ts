import { db } from "./db";
import { D, dubaiDate } from "./finance";
import { hoursBetween, attributedRevenue } from "./operations";
export async function loadOperationsData(
  user: { id: string; role: string },
  branchIds: string[],
) {
  const finance = ["OWNER", "MANAGER"].includes(user.role),
    tech = user.role === "TECHNICIAN",
    branch = { branchId: { in: branchIds } };
  const [
    jobs,
    items,
    stocks,
    movements,
    attendance,
    staff,
    sales,
    times,
    settings,
    recipes,
  ] = await Promise.all([
    db.jobCard.findMany({
      where: {
        ...branch,
        ...(tech ? { assignments: { some: { userId: user.id } } } : {}),
      },
      include: {
        assignments: {
          include: { user: { select: { id: true, name: true } } },
        },
        quotes: { orderBy: { version: "desc" }, include: { approval: true } },
        times: { include: { user: { select: { name: true } } } },
        events: { orderBy: { createdAt: "desc" } },
        sale: {
          select: {
            id: true,
            total: true,
            status: true,
            payments: { select: { amount: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    finance ? db.inventoryItem.findMany({ orderBy: { name: "asc" } }) : [],
    finance
      ? db.branchStock.findMany({ where: branch, include: { item: true } })
      : [],
    finance
      ? db.stockMovement.findMany({
          where: branch,
          include: { item: { select: { name: true, sku: true, unit: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    db.attendance.findMany({
      where: { ...(finance ? branch : { userId: user.id }) },
      include: { user: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
    }),
    db.user.findMany({
      where: tech
        ? { id: user.id }
        : { branches: { some: { branchId: { in: branchIds } } } },
      select: {
        id: true,
        name: true,
        title: true,
        active: true,
        productivityTarget: true,
        branches: true,
      },
    }),
    db.sale.findMany({
      where: {
        ...branch,
        status: "COMPLETED",
        ...(tech ? { workers: { some: { userId: user.id } } } : {}),
      },
      select: {
        id: true,
        branchId: true,
        net: finance,
        sample: true,
        createdAt: true,
        lines: { select: { name: true, category: true, serviceId: true } },
        workers: { select: { userId: true } },
      },
    }),
    db.technicianTime.findMany({
      where: { job: branch, ...(finance ? {} : { userId: user.id }) },
      include: { job: { select: { branchId: true, number: true } } },
    }),
    db.settings.findUniqueOrThrow({ where: { id: "company" } }),
    finance
      ? db.branchService.findMany({
          where: branch,
          include: {
            service: { select: { name: true } },
            branch: { select: { name: true } },
          },
        })
      : [],
  ]);
  const safeJobs = jobs.map((j) => {
    if (!tech && !finance)
      return {
        ...j,
        completionLines: undefined,
        quotes: j.quotes.map((q) => ({
          ...q,
          lines: (q.lines as any[]).map((l) => ({
            serviceId: l.serviceId,
            name: l.name,
            category: l.category,
            price: l.price,
          })),
          createdBy: undefined,
        })),
      };
    if (!tech) return j;
    return {
      id: j.id,
      number: j.number,
      branchId: j.branchId,
      plate: j.plate,
      vehicle: j.vehicle,
      requestedWork: j.requestedWork,
      status: j.status,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      estimatedCompletion: j.estimatedCompletion,
      assignments: j.assignments,
      times: j.times.filter((t) => t.userId === user.id),
      events: j.events,
      quotes: j.quotes.map((q) => ({
        id: q.id,
        version: q.version,
        approval: q.approval ? { createdAt: q.approval.createdAt } : null,
        lines: (q.lines as any[]).map((l) => ({
          name: l.name,
          materials: l.materials?.map((m: any) => ({
            name: m.name,
            quantity: m.quantity,
          })),
        })),
      })),
    };
  });
  return JSON.parse(
    JSON.stringify({
      jobs: safeJobs,
      items,
      stocks,
      movements,
      attendance,
      staff,
      sales,
      times,
      attendanceEnabled: settings.attendanceEnabled,
      recipes: recipes.map((r) => ({
        id: r.id,
        branchId: r.branchId,
        serviceId: r.serviceId,
        name: r.service.name,
        price: r.price,
        costs: r.costs,
        materials: r.stockMaterials,
      })),
    }),
  );
}
export function productivityReport(
  data: any,
  branchIds: string[],
  start: string,
  end: string,
  now = new Date(),
) {
  const scope = (b: string) => branchIds.includes(b),
    within = (d: string | Date) => {
      const day = dubaiDate(new Date(d));
      return day >= start && day <= end;
    },
    from = new Date(start + "T00:00:00+04:00"),
    through = new Date(end + "T23:59:59.999+04:00");
  const overlap = (t: any) =>
    hoursBetween(
      new Date(Math.max(new Date(t.startedAt).getTime(), from.getTime())),
      new Date(
        Math.min(
          new Date(t.endedAt ?? now).getTime(),
          through.getTime(),
          now.getTime(),
        ),
      ),
    );
  const jobs = data.jobs.filter((j: any) => scope(j.branchId)),
    sales = data.sales.filter(
      (s: any) => scope(s.branchId) && within(s.createdAt),
    );
  return data.staff
    .filter((s: any) => s.branches.some((b: any) => scope(b.branchId)))
    .map((person: any) => {
      const complete = jobs.filter(
        (j: any) =>
          j.completedAt &&
          within(j.completedAt) &&
          j.assignments.some((a: any) => a.userId === person.id),
      );
      const associated = sales.filter((s: any) =>
        s.workers.some((w: any) => w.userId === person.id),
      );
      const revenue = sales.reduce(
        (sum: ReturnType<typeof D>, s: any) =>
          sum.plus(
            s.net !== undefined
              ? (attributedRevenue(
                  String(s.net),
                  s.workers.map((w: any) => w.userId),
                )[person.id] ?? 0)
              : 0,
          ),
        D(0),
      );
      const worked = data.times
        .filter((t: any) => scope(t.job.branchId) && t.userId === person.id)
        .reduce((a: number, t: any) => a + overlap(t), 0);
      const present = data.attendance
        .filter((t: any) => scope(t.branchId) && t.userId === person.id)
        .reduce((a: number, t: any) => a + overlap(t), 0);
      const durations = complete
        .map((j: any) => {
          const entries = j.times.filter(
            (t: any) => t.userId === person.id && t.endedAt,
          );
          return entries.length
            ? entries.reduce(
                (minutes: number, t: any) =>
                  minutes + hoursBetween(t.startedAt, t.endedAt) * 60,
                0,
              )
            : null;
        })
        .filter((n: any): n is number => n !== null);
      return {
        id: person.id,
        name: person.name,
        target: person.productivityTarget ?? 0,
        assigned: jobs.filter(
          (j: any) =>
            !["DELIVERED", "CANCELLED", "COMPLETED"].includes(j.status) &&
            j.assignments.some((a: any) => a.userId === person.id),
        ).length,
        completed: complete.length,
        vehicles: associated.length,
        washes: associated.filter((s: any) =>
          s.lines.some(
            (l: any) =>
              l.category === "Car washing" || /wash/i.test(l.category),
          ),
        ).length,
        services: associated.reduce(
          (a: number, s: any) =>
            a +
            s.lines.filter(
              (l: any) => !(l.serviceId ?? "").startsWith("inventory:"),
            ).length,
          0,
        ),
        jobHours: Number(worked.toFixed(2)),
        attendanceHours: Number(present.toFixed(2)),
        averageSessionMinutes: durations.length
          ? Number(
              (
                durations.reduce((a: number, v: number) => a + v, 0) /
                durations.length
              ).toFixed(1),
            )
          : null,
        revenue: revenue.toFixed(2),
        hoursBasis: present > 0 ? "Attendance" : "Job timers",
        servicesPerHour:
          (present > 0 ? present : worked) >= 0.01
            ? Number(
                (
                  associated.reduce(
                    (a: number, s: any) =>
                      a +
                      s.lines.filter(
                        (l: any) =>
                          !(l.serviceId ?? "").startsWith("inventory:"),
                      ).length,
                    0,
                  ) / (present > 0 ? present : worked)
                ).toFixed(2),
              )
            : null,
      };
    });
}
