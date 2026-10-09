import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import {
  FinancialReport,
  FinanceData,
  forecastCompany,
  investmentROI,
} from "./intelligence";
import { D } from "./finance";
export type ExportCell = string | number | Date | null;
export interface Dataset {
  name: string;
  headers: string[];
  rows: ExportCell[][];
  money: number[];
  percent?: number[];
}
const n = (value: string | null) =>
  value === null ? null : D(value).toNumber();
const date = (day: string) => new Date(`${day}T00:00:00Z`);
export function exportDatasets(
  data: FinanceData,
  report: FinancialReport,
): Dataset[] {
  const branch = (id: string) =>
    report.branches.find((b) => b.id === id)?.code ?? id;
  const sets: Dataset[] = [
    {
      name: "Profit and loss",
      headers: ["Metric", "AED / count"],
      money: [1],
      rows: [
        ["Net revenue (VAT excluded)", n(report.summary.revenue)],
        ["Estimated direct service costs", n(report.summary.serviceCosts)],
        ["Contribution", n(report.summary.contribution)],
        ["Allocated operating expenses", n(report.summary.operatingExpenses)],
        ["Estimated operating profit", n(report.summary.operatingProfit)],
        ["Other recorded expenses", n(report.summary.otherExpenses)],
        ["Recorded tax expenses", n(report.summary.taxExpenses)],
        ["Estimated net profit", n(report.summary.netProfit)],
        ["VAT on selected invoices", n(report.summary.vat)],
        ["Customer receipts (VAT included)", n(report.summary.receipts)],
        ["Cash journal + receipt inflows", n(report.summary.cashIn)],
        ["Cash journal outflows", n(report.summary.cashOut)],
        ["Recorded net cash movement", n(report.summary.recordedCashFlow)],
        ["Outstanding invoices as of end date", n(report.summary.outstanding)],
        ["Vehicles serviced", report.summary.vehicles],
        ["Service lines completed", report.summary.services],
      ],
    },
    {
      name: "Sales",
      headers: [
        "Invoice",
        "Dubai date",
        "Branch",
        "Vehicle",
        "Selected services",
        "Sample",
        "Net sales",
        "Invoice VAT",
        "Invoice total",
        "Received as of end",
        "Est. cost",
        "Contribution",
        "Balance",
      ],
      money: [6, 7, 8, 9, 10, 11, 12],
      rows: report.saleRows.map((s) => [
        s.number,
        date(s.date),
        branch(s.branchId),
        s.plate,
        s.services,
        s.sample ? "SAMPLE" : "",
        n(s.net),
        n(s.vat),
        n(s.total),
        n(s.paid),
        n(s.cost),
        n(s.contribution),
        n(s.outstanding),
      ]),
    },
    {
      name: "Service profitability",
      headers: [
        "Service",
        "Category",
        "Count",
        "Net revenue",
        "Est. cost",
        "Contribution",
        "Margin",
      ],
      money: [3, 4, 5],
      percent: [6],
      rows: report.serviceRows.map((s) => [
        s.name,
        s.category,
        s.count,
        n(s.revenue),
        n(s.cost),
        n(s.contribution),
        s.margin === null ? null : D(s.margin).div(100).toNumber(),
      ]),
    },
    {
      name: "Branch comparison",
      headers: [
        "Branch",
        "Net revenue",
        "Est. service costs",
        "Operating expenses",
        "Est. operating profit",
        "Est. net profit",
        "Vehicles",
      ],
      money: [1, 2, 3, 4, 5],
      rows: report.branchRows.map((b) => [
        b.name,
        n(b.summary.revenue),
        n(b.summary.serviceCosts),
        n(b.summary.operatingExpenses),
        n(b.summary.operatingProfit),
        n(b.summary.netProfit),
        b.summary.vehicles,
      ]),
    },
    {
      name: "Expense analysis",
      headers: [
        "Branch",
        "Month",
        "Category",
        "Type",
        "Description",
        "Allocated AED",
        "Sample",
      ],
      money: [5],
      rows: report.expenseRows.map((e) => [
        branch(e.branchId),
        e.month,
        e.category,
        e.kind,
        e.description,
        n(e.amount),
        e.sample ? "SAMPLE" : "",
      ]),
    },
    {
      name: "Cash flow",
      headers: [
        "Dubai date",
        "Branch",
        "Direction",
        "Source",
        "Description",
        "Amount AED",
        "Sample",
      ],
      money: [5],
      rows: report.cashRows.map((c) => [
        date(c.date),
        branch(c.branchId),
        c.direction,
        c.category,
        c.description,
        n(c.amount),
        c.sample ? "SAMPLE" : "",
      ]),
    },
    {
      name: "Daily sales",
      headers: [
        "Dubai date",
        "Net revenue",
        "Est. service cost",
        "Contribution",
        "Vehicles",
        "Services",
      ],
      money: [1, 2, 3],
      rows: report.dailyRows.map((d) => [
        date(d.date),
        n(d.revenue),
        n(d.cost),
        n(d.contribution),
        d.vehicles,
        d.services,
      ]),
    },
  ];
  if (!report.filtered) {
    const forecast = forecastCompany(
      data,
      report.branches.map((b) => b.id),
      report.end,
    );
    sets.push({
      name: "Forecast",
      headers: [
        "Branch",
        "Scenario",
        "Forecast revenue",
        "Forecast expenses",
        "Est. operating profit",
        "Est. net profit",
        "Margin",
      ],
      money: [2, 3, 4, 5],
      percent: [6],
      rows: forecast.branches.flatMap((b) =>
        b.scenarios.map((s) => [
          branch(b.branchId),
          s.name,
          n(s.revenue),
          n(s.totalExpenses),
          n(s.operatingProfit),
          n(s.netProfit),
          s.margin === null ? null : D(s.margin).div(100).toNumber(),
        ]),
      ),
    });
    sets.push({
      name: "Investment ROI",
      headers: [
        "Branch",
        "Capital commitment",
        "Capital paid",
        "Deposit held",
        "MTD operating profit",
        "Recorded operating cash",
        "Remaining recovery",
        "Payback months",
        "Projected date",
        "Cash reviewed through",
      ],
      money: [1, 2, 3, 4, 5, 6],
      rows: report.branches.map((b) => {
        const r = investmentROI(data, b.id, report.end);
        return [
          b.name,
          n(r.capitalAmount),
          n(r.capitalPaid),
          n(r.depositHeld),
          n(r.monthlyOperatingProfit),
          n(r.cumulativeOperatingCash),
          n(r.remainingInvestment),
          r.paybackMonths ? D(r.paybackMonths).toNumber() : null,
          r.projectedRecoveryDate
            ? date(r.projectedRecoveryDate)
            : "Unavailable",
          r.cashReviewedThrough ? date(r.cashReviewedThrough) : "Unreconciled",
        ];
      }),
    });
  }
  return sets;
}
const csvCell = (value: ExportCell) => {
  let text =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value === null
        ? ""
        : String(value);
  if (
    (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) ||
    (typeof value === "string" && /^[\t\r\n]/.test(text))
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function csvExport(dataset: Dataset) {
  return (
    "\uFEFF" +
    [dataset.headers, ...dataset.rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
export async function excelExport(
  datasets: Dataset[],
  report: FinancialReport,
) {
  const book = new ExcelJS.Workbook();
  book.creator = "Protune Auto Services";
  book.created = new Date();
  book.calcProperties.fullCalcOnLoad = true;
  for (const dataset of datasets) {
    const sheet = book.addWorksheet(dataset.name, {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: {
        orientation:
          dataset.name === "Profit and loss" ? "portrait" : "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    const columns = dataset.headers.length;
    sheet.mergeCells(1, 1, 1, columns);
    sheet.getCell("A1").value = "PROTUNE AUTO SERVICES";
    sheet.getCell("A1").font = {
      name: "Arial",
      size: 18,
      bold: true,
      color: { argb: "FF137C59" },
    };
    sheet.mergeCells(2, 1, 2, columns);
    sheet.getCell("A2").value =
      `${dataset.name} | ${report.start} to ${report.end} | ${report.branches.map((b) => b.code).join(", ")}`;
    sheet.mergeCells(3, 1, 3, columns);
    sheet.getCell("A3").value = report.sample
      ? "SAMPLE DATA INCLUDED - Fictional seeded records; financial estimates"
      : "Financial estimates - recorded operations";
    sheet.getCell("A3").font = { color: { argb: "FFA87926" }, size: 10 };
    sheet.mergeCells(4, 1, 4, columns);
    sheet.getCell("A4").value = report.filtered
      ? "Sales filters applied; overhead is unallocated. Blank profit/cash totals are unavailable."
      : "VAT excluded from revenue; recurring expenses allocated; cash journal separate.";
    sheet.getCell("A4").font = { size: 10, color: { argb: "FF788B7B" } };
    sheet.getRow(6).values = dataset.headers;
    sheet.getRow(6).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 10,
    };
    sheet.getRow(6).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF137C59" },
    };
    sheet.getRow(6).height = 30;
    for (const [index, values] of dataset.rows.entries()) {
      const row = sheet.addRow(values);
      row.font = { name: "Arial", size: 10 };
      row.alignment = { vertical: "middle", wrapText: true };
      row.height = 32;
      if (index % 2 === 0)
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F7F3" },
        };
      for (const [col, value] of values.entries()) {
        const cell = row.getCell(col + 1);
        if (value instanceof Date) cell.numFmt = "yyyy-mm-dd";
        else if (dataset.percent?.includes(col)) cell.numFmt = "0.0%";
        else if (dataset.money.includes(col))
          cell.numFmt = '"AED "#,##0.00;[Red]("AED "#,##0.00)';
        else if (typeof value === "number") cell.numFmt = "#,##0.##";
        if (typeof value === "number" && value < 0)
          cell.font = { name: "Arial", size: 10, color: { argb: "FFB75E47" } };
      }
    }
    sheet.autoFilter = {
      from: { row: 6, column: 1 },
      to: { row: 6, column: columns },
    };
    dataset.headers.forEach((header, i) => {
      let width = Math.max(14, header.length + 3);
      if (["Service", "Category", "Branch"].includes(header)) width = 25;
      if (["Selected services", "Description", "Metric"].includes(header))
        width = 48;
      if (header === "Invoice") width = 33;
      if (header === "Vehicle") width = 23;
      sheet.getColumn(i + 1).width = width;
    });
    sheet.getRow(1).height = 30;
    sheet.getRow(2).height = 32;
    for (const row of [2, 3, 4])
      sheet.getRow(row).alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(3).height = 22;
    sheet.getRow(4).height = 26;
    sheet.pageSetup.printTitlesRow = "1:6";
    sheet.headerFooter.oddFooter = "Protune | &P of &N | AED | Dubai";
  }
  // A static report export uses cached results alongside simple reconciliation formulas.
  const summary = book.getWorksheet("Profit and loss");
  if (summary && !report.filtered) {
    for (const [cell, formula, result] of [
      ["B9", "B7-B8", n(report.summary.contribution)],
      ["B11", "B9-B10", n(report.summary.operatingProfit)],
      ["B14", "B11-B12-B13", n(report.summary.netProfit)],
      ["B19", "B17-B18", n(report.summary.recordedCashFlow)],
    ] as const)
      summary.getCell(cell).value = { formula, result: result ?? 0 };
    for (const row of [21, 22]) summary.getCell(`B${row}`).numFmt = "#,##0";
  }
  if (summary)
    for (const row of [21, 22]) summary.getCell(`B${row}`).numFmt = "#,##0";
  const notes = book.addWorksheet("Definitions");
  notes.getColumn(1).width = 110;
  notes.addRow([
    "Source: Protune PostgreSQL transactions, price/cost snapshots, expense revisions and cash journal.",
  ]);
  notes.addRow([
    `Report period: ${report.start} - ${report.end}; dates in Asia/Dubai.`,
  ]);
  report.notes.forEach((note) => {
    const row = notes.addRow([note]);
    row.height = 40;
    row.alignment = { wrapText: true, vertical: "middle" };
  });
  notes.addRow([
    "Forecasts use current configured assumptions as of the report end date. Historical forecasts are scenarios, not archived predictions.",
  ]);
  notes.addRow([
    "ROI recovery dates require a reconciled cash journal and an explicit owner cash-flow assumption. Deposits are excluded from capital investment.",
  ]);
  notes.pageSetup = {
    orientation: "portrait",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
  };
  notes.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: "middle" };
    row.height = 48;
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}
function printable(text: string, font: PDFFont) {
  return [...text]
    .map((char) => {
      try {
        font.encodeText(char);
        return char;
      } catch {
        return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`;
      }
    })
    .join("");
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = printable(text, font).split(/\s+/),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(line + char, size) > width) {
        lines.push(line);
        line = char;
      } else line += char;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
export async function pdfExport(dataset: Dataset, report: FinancialReport) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Protune ${dataset.name}`);
  pdf.setAuthor("Protune Auto Services");
  // Reduce wide source ledgers to readable financial columns for PDF; CSV/Excel retain full detail.
  let heads = dataset.headers,
    rows = dataset.rows,
    money = dataset.money,
    percent = dataset.percent ?? [];
  const selected =
    dataset.name === "Sales"
      ? [0, 1, 2, 3, 6, 8, 12]
      : dataset.name === "Investment ROI"
        ? [0, 1, 3, 4, 5, 6, 8]
        : dataset.name === "Inventory movement"
          ? [0, 1, 2, 4, 5, 7, 9]
          : dataset.name === "Employee productivity"
            ? [0, 2, 3, 4, 6, 7, 9, 10]
            : dataset.name === "Customer spending"
              ? [0, 3, 4, 5, 6, 7, 8]
              : dataset.name === "Customer history"
                ? [0, 2, 3, 4, 5, 8, 10, 11]
                : dataset.name === "Campaign performance"
                  ? [0, 1, 3, 4, 6, 7, 10]
                  : dataset.name === "Voucher performance"
                    ? [0, 1, 3, 4, 5, 7]
                    : null;
  if (selected) {
    heads = selected.map((i) => heads[i]);
    rows = rows.map((row) => selected.map((i) => row[i]));
    money = selected
      .map((old, index) => (dataset.money.includes(old) ? index : -1))
      .filter((i) => i >= 0);
    percent = [];
  }
  const landscape = heads.length > 3,
    width = landscape ? 841.89 : 595.28,
    height = landscape ? 595.28 : 841.89,
    left = 40,
    tableWidth = width - 80,
    size = 8.5;
  let page!: PDFPage,
    y = 0;
  const weights = heads.map((head, i) =>
      ["Metric", "Description", "Service", "Branch"].includes(head)
        ? 2.5
        : head === "Invoice"
          ? 2.5
          : money.includes(i)
            ? 1.5
            : 1,
    ),
    totalWeight = weights.reduce((a, b) => a + b, 0),
    widths = weights.map((w) => (w / totalWeight) * tableWidth);
  const text = (
    value: string,
    x: number,
    yy: number,
    weight = false,
    s = 9,
    color = rgb(0.16, 0.26, 0.2),
  ) =>
    page.drawText(printable(value, weight ? bold : font), {
      x,
      y: yy,
      font: weight ? bold : font,
      size: s,
      color,
    });
  const newPage = () => {
    page = pdf.addPage([width, height]);
    text(
      "PROTUNE AUTO SERVICES",
      left,
      height - 42,
      true,
      18,
      rgb(0.07, 0.48, 0.34),
    );
    text(dataset.name, left, height - 66, true, 13);
    text(
      `${report.start} to ${report.end} | ${report.branches.map((b) => b.code).join(", ")} | AED | Asia/Dubai`,
      left,
      height - 84,
      false,
      9,
    );
    text(
      report.sample
        ? "SAMPLE DATA INCLUDED - Fictional seeded records. Financial figures include estimates."
        : "Recorded operations. Costs and profitability include estimates.",
      left,
      height - 103,
      false,
      8,
      rgb(0.58, 0.43, 0.16),
    );
    y = height - 126;
    const headingLines = heads.map((h, i) =>
        wrap(h, bold, size, widths[i] - 12),
      ),
      headingHeight = Math.max(...headingLines.map((l) => l.length)) * 11 + 12;
    page.drawRectangle({
      x: left,
      y: y - headingHeight,
      width: tableWidth,
      height: headingHeight,
      color: rgb(0.07, 0.48, 0.34),
    });
    let x = left;
    headingLines.forEach((lines, i) => {
      lines.forEach((line, j) =>
        text(line, x + 6, y - 11 - j * 11, true, size, rgb(1, 1, 1)),
      );
      x += widths[i];
    });
    y -= headingHeight;
  };
  newPage();
  let rowNumber = 0;
  for (const row of rows) {
    const lines = row.map((value, i) => {
      const formatted =
        value instanceof Date
          ? value.toISOString().slice(0, 10)
          : value === null
            ? "Unavailable"
            : typeof value === "number" && percent.includes(i)
              ? `${(value * 100).toFixed(1)}%`
              : typeof value === "number" &&
                  money.includes(i) &&
                  !(
                    dataset.name === "Profit and loss" &&
                    ["Vehicles serviced", "Service lines completed"].includes(
                      String(row[0]),
                    )
                  )
                ? value.toLocaleString("en-AE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : String(value);
      return wrap(formatted, font, size, widths[i] - 12);
    });
    const rowHeight = Math.max(1, ...lines.map((l) => l.length)) * 11 + 14;
    if (y - rowHeight < 65) newPage();
    if (rowNumber++ % 2 === 0)
      page.drawRectangle({
        x: left,
        y: y - rowHeight,
        width: tableWidth,
        height: rowHeight,
        color: rgb(0.95, 0.97, 0.95),
      });
    let x = left;
    lines.forEach((words, i) => {
      words.forEach((word, j) =>
        text(
          word,
          x + 6,
          y - 12 - j * 11,
          false,
          size,
          typeof row[i] === "number" && Number(row[i]) < 0
            ? rgb(0.68, 0.31, 0.22)
            : rgb(0.2, 0.31, 0.24),
        ),
      );
      x += widths[i];
    });
    y -= rowHeight;
  }
  if (!rows.length) {
    text("No records for this selection.", left + 6, y - 22);
    y -= 40;
  }
  y -= 20;
  for (const note of report.notes) {
    const lines = wrap(note, font, 8, tableWidth);
    if (y - lines.length * 11 < 60) {
      newPage();
      y -= 10;
    }
    for (const line of lines) {
      text(line, left, y, false, 8, rgb(0.44, 0.51, 0.45));
      y -= 11;
    }
    y -= 7;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(
      `Protune | ${i + 1} of ${pages.length} | ${report.closed ? "Closed snapshot" : "Live report"} | Confidential`,
      { x: left, y: 25, font, size: 8, color: rgb(0.5, 0.57, 0.5) },
    ),
  );
  return Buffer.from(await pdf.save());
}
