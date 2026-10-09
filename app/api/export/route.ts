import { NextResponse } from "next/server";
import {
  authorizedReport,
  reportFailure,
  ReportError,
} from "@/lib/report-query";
import { loadFinanceData, reportWithSnapshots } from "@/lib/finance-data";
import {
  exportDatasets,
  csvExport,
  excelExport,
  pdfExport,
} from "@/lib/exports";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const options = await authorizedReport(req),
      url = new URL(req.url),
      format = url.searchParams.get("format") ?? "csv",
      selected = url.searchParams.get("report") ?? "Profit and loss";
    if (!["csv", "xlsx", "pdf"].includes(format))
      throw new ReportError("Unsupported export format", 400);
    const source = await loadFinanceData(options.branchIds),
      report = reportWithSnapshots(source, options),
      datasets = exportDatasets(source, report),
      dataset = datasets.find((d) => d.name === selected);
    if (!dataset)
      throw new ReportError("Report unavailable for these filters", 400);
    const bytes =
        format === "csv"
          ? Buffer.from(csvExport({...dataset,headers:[...dataset.headers,"Report from","Report through","Data status"],rows:dataset.rows.map(row=>[...row,report.start,report.end,report.sample?"SAMPLE DATA INCLUDED / financial estimates":"Recorded financial estimates"])}), "utf8")
          : format === "xlsx"
            ? await excelExport(datasets, report)
            : await pdfExport(dataset, report),
      mime =
        format === "csv"
          ? "text/csv; charset=utf-8"
          : format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
      filename = `protune-${selected.toLowerCase().replaceAll(" ", "-")}-${options.start}-${options.end}.${format}`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const failure = reportFailure(error);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
}
