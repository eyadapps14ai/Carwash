import { voucherState } from "@/lib/marketing";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadMarketingData } from "@/lib/marketing-data";
import { loadFinanceData } from "@/lib/finance-data";
import { buildReport } from "@/lib/intelligence";
import { csvExport, excelExport, pdfExport, Dataset } from "@/lib/exports";
import { businessDate } from "@/lib/finance-actions";
import { dubaiDate } from "@/lib/finance";
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Sign in required", { status: 401 });
  if (u.role === "TECHNICIAN")
    return new Response("Forbidden", { status: 403 });
  const p = new URL(req.url).searchParams,
    branch = p.get("branch") ?? "all",
    branches = await db.branch.findMany({
      where:
        u.role === "OWNER"
          ? {}
          : { id: { in: u.branches.map((b) => b.branchId) } },
    });
  const ids = branches
    .filter((b) => branch === "all" || b.id === branch)
    .map((b) => b.id);
  if (!ids.length) return new Response("Forbidden", { status: 403 });
  const start = businessDate.safeParse(
      p.get("start") ?? dubaiDate().slice(0, 7) + "-01",
    ),
    end = businessDate.safeParse(p.get("end") ?? dubaiDate());
  if (
    !start.success ||
    !end.success ||
    start.data > end.data ||
    end.data > dubaiDate() ||
    Date.parse(end.data) - Date.parse(start.data) > 365 * 86400000
  )
    return new Response("Select up to 366 days through today", { status: 400 });
  const data = await loadMarketingData(u, ids, start.data, end.data);
  if (!p.get("format"))
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  if (!["OWNER", "MANAGER"].includes(u.role))
    return new Response("Forbidden", { status: 403 });
  const type = p.get("report") ?? "Campaign performance";
  let dataset: Dataset;
  if (type === "Campaign performance")
    dataset = {
      name: type,
      headers: [
        "Campaign",
        "Issued",
        "Accepted",
        "Delivered",
        "Redeemed",
        "Returning customers",
        "Net revenue",
        "Discounts",
        "Direct cost",
        "Allocated campaign budget",
        "Estimated contribution",
      ],
      money: [6, 7, 8, 9, 10],
      rows: data.stats.map((s: any) => [
        data.campaigns.find((c: any) => c.id === s.campaignId)?.name ?? "",
        s.issued,
        s.accepted,
        s.delivered,
        s.redeemed,
        s.returning,
        ...[
          "net",
          "discount",
          "directCost",
          "marketingCost",
          "contribution",
        ].map((k) => Number(s[k])),
      ]),
    };
  else if (type === "Voucher performance")
    dataset = {
      name: type,
      headers: [
        "Code",
        "Campaign",
        "Customer",
        "Issued",
        "Expires",
        "Status",
        "Invoice",
        "Discount",
      ],
      money: [7],
      rows: data.vouchers.map((v: any) => [
        v.code,
        data.campaigns.find((c: any) => c.id === v.campaignId)?.name ?? "",
        v.customer.name,
        new Date(v.issuedAt),
        new Date(v.expiresAt),
        voucherState(v),
        v.redemption?.number ?? "",
        Number(v.redemption?.discount ?? 0),
      ]),
    };
  else return new Response("Invalid report", { status: 400 });
  const report = buildReport(await loadFinanceData(ids), {
    branchIds: ids,
    start: start.data,
    end: end.data,
  });
  report.notes = [
    "Campaign results use the selected Dubai dates and authorized branches. Issuance/delivery uses the issuing branch; invoice results use the redemption branch.",
    "Estimated contribution equals attributed net revenue less historical direct service costs and allocated campaign budget. It excludes general overhead and is not an estimate of incremental lift. Discounts are already deducted from revenue.",
    "The full configured campaign budget is allocated equally to configured branches and deducted even when filtering a shorter period; enter delivery and other campaign costs in that budget. Accepted is provider acceptance; delivered requires a verified webhook.",
    "Cancelled redemptions are excluded; loyalty/referral qualification requires fully settled invoices. Fictional sample messages are never sent.",
  ];
  let body: string | Uint8Array, contentType: string;
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
  } else return new Response("Invalid format", { status: 400 });
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="protune-${type.toLowerCase().replaceAll(" ", "-")}.${format}"`,
    },
  });
}
