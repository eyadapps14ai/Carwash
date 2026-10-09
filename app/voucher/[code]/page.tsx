import { db } from "@/lib/db";
import { offerText, voucherState } from "@/lib/marketing";
import { dubaiDate, money } from "@/lib/finance";
export const dynamic = "force-dynamic";
export default async function DigitalVoucher({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const v = /^PT-[A-F0-9]{18}$/.test(code)
    ? await db.voucher.findUnique({
        where: { code },
        include: { campaign: true },
      })
    : null;
  if (!v)
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>Voucher unavailable</h1>
          <p>Check the code in your original message.</p>
        </section>
      </main>
    );
  const rules = v.rules as any,
    branches = await db.branch.findMany({
      where: { id: { in: rules.branchIds } },
      select: { name: true },
    }),
    services = await db.service.findMany({
      where: { id: { in: rules.serviceIds } },
      select: { name: true },
    });
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PROTUNE · DIGITAL VOUCHER</span>
        {v.sample && <p className="note">Fictional sample</p>}
        <h1>{rules.campaignName}</h1>
        <p>{offerText(rules)}</p>
        <h2>{v.code}</h2>
        <p>
          {voucherState(v)}
          {!v.campaign.active ? " · Campaign paused" : ""}
        </p>
        <p>
          Valid until {dubaiDate(v.expiresAt)}. Minimum spending{" "}
          {money(rules.minimumSpend)} before VAT.
        </p>
        <p>Branches: {branches.map((b) => b.name).join(", ")}</p>
        <p>
          Services:{" "}
          {services.length
            ? services.map((s) => s.name).join(", ")
            : "All services"}
        </p>
        <p className="note">
          Show this code at checkout. One use, registered customer only. Cannot
          be combined with another discount. A free-service reward covers one
          lowest priced eligible service.
        </p>
      </section>
    </main>
  );
}
