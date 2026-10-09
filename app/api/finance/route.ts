import { NextResponse } from "next/server";
import { authorizedReport, reportFailure } from "@/lib/report-query";
import { loadFinanceData, reportWithSnapshots } from "@/lib/finance-data";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const options = await authorizedReport(req);
    const source = await loadFinanceData(options.branchIds);
    return NextResponse.json(reportWithSnapshots(source, options), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const failure = reportFailure(error);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
}
