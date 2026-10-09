import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCRMData, customerReportRows } from "@/lib/crm-data";
import { businessDate } from "@/lib/finance-actions";
import { dubaiDate } from "@/lib/finance";
import { csvExport, excelExport, pdfExport, type Dataset } from "@/lib/exports";
import { buildReport } from "@/lib/intelligence";
import { loadFinanceData } from "@/lib/finance-data";
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (u.role === "TECHNICIAN")
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  try {
    const p = new URL(req.url).searchParams,
      branches = await db.branch.findMany({
        where:
          u.role === "OWNER"
            ? {}
            : { id: { in: u.branches.map((b) => b.branchId) } },
      }),
      branch = p.get("branch") ?? "all",
      ids =
        branch === "all"
          ? branches.map((b) => b.id)
          : branches.filter((b) => b.id === branch).map((b) => b.id);
    if (!ids.length)
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const data = await loadCRMData(u, ids);
    if (!data.enabled)
      return NextResponse.json(
        { error: "Customer management is disabled" },
        { status: 409 },
      );
    const customerId = p.get("customer");
    if (customerId && !data.customers.some((c: any) => c.id === customerId))
      return NextResponse.json(
        { error: "Customer unavailable" },
        { status: 404 },
      );
    if (!p.get("format"))
      return NextResponse.json(
        customerId
          ? {
              ...data,
              customers: data.customers.filter((c: any) => c.id === customerId),
            }
          : data,
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!["OWNER", "MANAGER"].includes(u.role))
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const start = businessDate.parse(
        p.get("start") ?? dubaiDate().slice(0, 7) + "-01",
      ),
      end = businessDate.parse(p.get("end") ?? dubaiDate());
    if (
      start > end ||
      end > dubaiDate() ||
      new Date(end).getTime() - new Date(start).getTime() > 365 * 86400000
    )
      throw new Error("Select up to 366 days through today");
    const rows = customerReportRows(
        data.customers.filter((c: any) => !customerId || c.id === customerId),
        start,
        end,
      ),
      type = p.get("report") ?? "Customer spending";
    let dataset: Dataset;
    if (type === "Customer spending")
      dataset = {
        name: type,
        headers: [
          "Customer",
          "Mobile",
          "Vehicles",
          "Visits",
          "Net revenue",
          "Invoiced incl. VAT",
          "Payments on selected invoices",
          "Outstanding on selected invoices",
          "Last invoiced visit",
          "Sample",
        ],
        money: [4, 5, 6, 7],
        rows: rows.map((c: any) => [
          c.name,
          c.mobile,
          c.vehicles.length,
          c.visits,
          Number(c.net),
          Number(c.invoiced),
          Number(c.paid),
          Number(c.balance),
          c.lastVisit ? new Date(c.lastVisit + "T00:00:00Z") : null,
          c.sample ? "Yes" : "No",
        ]),
      };
    else if (type === "Customer history")
      dataset = {
        name: type,
        headers: [
          "Customer",
          "Invoice",
          "Dubai date",
          "Branch",
          "Vehicle plate",
          "Services",
          "Net revenue",
          "VAT",
          "Total",
          "Paid",
          "Outstanding",
          "State",
          "Sample",
        ],
        money: [6, 7, 8, 9, 10],
        rows: rows.flatMap((c: any) =>
          c.sales.map((s: any) => {
            const stats = customerReportRows(
              [{ ...c, sales: [s] }],
              start,
              end,
            )[0];
            return [
              c.name,
              s.number,
              new Date(dubaiDate(new Date(s.createdAt)) + "T00:00:00Z"),
              branches.find((b) => b.id === s.branchId)?.code ?? "",
              s.plate,
              s.lines.map((l: any) => l.name).join("; "),
              Number(s.net),
              Number(s.vat),
              Number(s.total),
              Number(stats.paid),
              Number(stats.balance),
              s.status,
              c.sample || s.sample ? "Yes" : "No",
            ];
          }),
        ),
      };
    else throw new Error("Invalid customer report");
    const report = buildReport(await loadFinanceData(ids), {
      branchIds: ids,
      start,
      end,
    });
    report.sample = rows.some((c: any) => c.sample);
    report.notes = [
      "Customer history and spending are restricted to selected authorized branches. Visits count completed invoices once; uninvoiced jobs do not count as spending.",
      "Net revenue excludes VAT; invoiced amounts include VAT. Cancelled invoices are retained in history and excluded from spending totals.",
      "Payments and balances include all payments currently recorded on invoices issued in the selected dates, even if payment occurred later. These are current balances, not historical as-of balances.",
      "Vehicles count registered vehicles. Customer and vehicle snapshots on invoices remain unchanged after profile edits. PDF shows selected readable columns; Excel and CSV retain full columns.",
    ];
    let body: Uint8Array | string, contentType: string;
    const format = p.get("format");
    if (format === "csv") {
      body = csvExport(dataset);
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
            ? "Customer data is temporarily unavailable"
            : e instanceof Error
              ? e.message
              : "Check filters",
      },
      { status: 400 },
    );
  }
}
