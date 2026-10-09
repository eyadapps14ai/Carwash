import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryUsage } from "@/lib/operations";
import { loadOperationsData, productivityReport } from "@/lib/operations-data";
import { businessDate } from "@/lib/finance-actions";
import { dubaiDate } from "@/lib/finance";
import { csvExport, excelExport, pdfExport, type Dataset } from "@/lib/exports";
import { loadFinanceData } from "@/lib/finance-data";
import { buildReport } from "@/lib/intelligence";
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const p = new URL(req.url).searchParams,
      b = p.get("branch") ?? "all",
      branches = await db.branch.findMany({
        where:
          u.role === "OWNER"
            ? {}
            : { id: { in: u.branches.map((x) => x.branchId) } },
      }),
      ids =
        b === "all"
          ? branches.map((x) => x.id)
          : branches.filter((x) => x.id === b).map((x) => x.id);
    if (!ids.length)
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const data = await loadOperationsData(u, ids),
      start = businessDate.parse(
        p.get("start") ?? dubaiDate().slice(0, 7) + "-01",
      ),
      end = businessDate.parse(p.get("end") ?? dubaiDate());
    if (
      start > end ||
      end > dubaiDate() ||
      new Date(end).getTime() - new Date(start).getTime() > 365 * 86400000
    )
      throw new Error("Select up to 366 days through today");
    const productivity = productivityReport(data, ids, start, end);
    const format = p.get("format");
    if (!format)
      return NextResponse.json(
        { ...data, productivity },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!["OWNER", "MANAGER"].includes(u.role))
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const type = p.get("report") ?? "Employee productivity";
    let dataset: Dataset;
    if (type === "Inventory movement")
      dataset = {
        name: type,
        headers: [
          "Dubai date",
          "Branch",
          "Item",
          "SKU",
          "Movement",
          "Quantity",
          "Unit cost",
          "Value",
          "Reference",
          "Reason",
        ],
        money: [6, 7],
        rows: data.movements
          .filter(
            (m: any) =>
              dubaiDate(new Date(m.createdAt)) >= start &&
              dubaiDate(new Date(m.createdAt)) <= end,
          )
          .map((m: any) => [
            new Date(dubaiDate(new Date(m.createdAt)) + "T00:00:00Z"),
            branches.find((b) => b.id === m.branchId)?.code ?? "",
            m.item.name,
            m.item.sku,
            m.kind,
            Number(m.quantity),
            Number(m.unitCost),
            Number(m.value),
            m.reference,
            m.note,
          ]),
      };
    else if (type === "Inventory usage")
      dataset = {
        name: type,
        headers: [
          "Item",
          "SKU",
          "Branch",
          "Unit",
          "Quantity used",
          "Consumed cost",
        ],
        money: [5],
        rows: inventoryUsage(
          data.movements.filter(
            (m: any) =>
              dubaiDate(new Date(m.createdAt)) >= start &&
              dubaiDate(new Date(m.createdAt)) <= end,
          ),
        ).map((r) => [
          r.name,
          r.sku,
          branches.find((b) => b.id === r.branchId)?.code ?? "",
          r.unit,
          Number(r.quantity),
          Number(r.cost),
        ]),
      };
    else if (type === "Employee productivity")
      dataset = {
        name: "Employee productivity",
        headers: [
          "Employee",
          "Open assigned jobs",
          "Completed jobs",
          "Associated vehicles",
          "Associated services",
          "Washes",
          "Job hours",
          "Attendance hours",
          "Average recorded job minutes",
          "Allocated net revenue",
          "Services / recorded hour",
          "Monthly target",
        ],
        money: [9],
        rows: productivity.map((r: any) => [
          r.name,
          r.assigned,
          r.completed,
          r.vehicles,
          r.services,
          r.washes,
          r.jobHours,
          r.attendanceHours,
          r.averageSessionMinutes,
          Number(r.revenue),
          r.servicesPerHour,
          r.target,
        ]),
      };
    else throw new Error("Invalid operations report");
    const report = buildReport(await loadFinanceData(ids), {
      branchIds: ids,
      start,
      end,
    });
    report.sample =
      type === "Employee productivity" &&
      (data.jobs.some((j: any) => j.sample) ||
        data.sales.some((s: any) => s.sample));
    report.notes = [
      "Revenue excludes VAT. Shared invoice revenue is allocated to workers equally, preserving cents. Associated work counts overlap across team members; stock part lines are excluded from service counts.",
      "Hours are recorded timers or attendance, not payroll. Hourly rates require at least 0.01 recorded hour. Average recorded job duration excludes jobs with no recorded time.",
      "Receipts and transfers are stock records, not cash entries or expenses. Consumption cost uses weighted stock cost at completion. Excel/CSV retain full report columns.",
    ];
    report.notes.push(
      "Customer payments and payroll expenses are recorded in their separate workflows.",
    );
    let body: Uint8Array | string, contentType: string;
    if (format === "csv") {
      body = csvExport({
        ...dataset,
        headers: [...dataset.headers, "Data status", "Report period"],
        rows: dataset.rows.map((row) => [
          ...row,
          report.sample ? "Sample data included" : "Recorded operations",
          `${start} to ${end}`,
        ]),
      });
      contentType = "text/csv; charset=utf-8";
    } else if (format === "xlsx") {
      body = await excelExport([dataset], report);
      contentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (format === "pdf") {
      body = await pdfExport(dataset, report);
      contentType = "application/pdf";
    } else throw new Error("Invalid format");
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="protune-${type.toLowerCase().replaceAll(" ", "-")}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Prisma.PrismaClientKnownRequestError ||
          e instanceof Prisma.PrismaClientInitializationError
            ? "Reporting is temporarily unavailable. Retry shortly."
            : e instanceof Error
              ? e.message
              : "Check report filters",
      },
      { status: 400 },
    );
  }
}
