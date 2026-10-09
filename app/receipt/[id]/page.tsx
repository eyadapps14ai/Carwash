import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { canBranch, currentUser } from "@/lib/auth";
import { money, D } from "@/lib/finance";
import Print from "./print";
export const dynamic = "force-dynamic";
export default async function Receipt({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user || user.role === "TECHNICIAN") notFound();
  const s = await db.sale.findUnique({
    where: { id: (await params).id },
    include: { branch: true, lines: true, payments: true, cashier: true },
  });
  if (!s || !canBranch(user, s.branchId)) notFound();
  const settings = await db.settings.findUniqueOrThrow({
    where: { id: "company" },
  });
  const paid = s.payments.reduce((a, p) => a.plus(p.amount.toString()), D(0));
  return (
    <main className="receipt">
      <div className="brand">
        <span className="brandmark">P</span>
        <div>
          PROTUNE<small>AUTO SERVICES</small>
        </div>
      </div>
      <h1>{settings.trn ? "Tax invoice" : "Service receipt"}</h1>
      <p>
        {settings.companyName} · {s.branch.name}
      </p>
      {settings.trn && <p>TRN: {settings.trn}</p>}
      {s.sample && (
        <div className="notice">
          SAMPLE RECORD — Fictional transaction for testing
        </div>
      )}
      <dl>
        <div>
          <dt>Receipt number</dt>
          <dd>{s.number}</dd>
        </div>
        <div>
          <dt>Dubai date and time</dt>
          <dd>
            {s.createdAt.toLocaleString("en-AE", { timeZone: "Asia/Dubai" })}
          </dd>
        </div>
        <div>
          <dt>Customer / vehicle</dt>
          <dd>
            {s.customerName} · {s.plate}
          </dd>
        </div>
        <div>
          <dt>Cashier / status</dt>
          <dd>
            {s.cashier.name} · {s.status}
          </dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Price excl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td>{money(l.price.toString())}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        {[
          ["Subtotal", s.subtotal],
          ["Discount", s.discount],
          ["Net amount", s.net],
          [`VAT (${s.vatRate}%)`, s.vat],
          ["Total", s.total],
          ["Paid", paid],
          ["Outstanding", D(s.total.toString()).minus(paid)],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <span>{String(label)}</span>
            <b>{money(String(value))}</b>
          </div>
        ))}
      </div>
      <p>
        Payments:{" "}
        {s.payments.length
          ? s.payments
              .map((p) => `${p.method} ${money(p.amount.toString())}`)
              .join(" · ")
          : "None received"}
      </p>
      <p className="note">Thank you for choosing Protune Auto Services.</p>
      <Print />
    </main>
  );
}
