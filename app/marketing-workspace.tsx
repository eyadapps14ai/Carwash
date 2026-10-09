"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { money, dubaiDate } from "@/lib/finance";
import { offerText, voucherState } from "@/lib/marketing";
type Row = Record<string, any>;
export default function MarketingWorkspace({
  data,
  branch,
}: {
  data: Row;
  branch: string;
}) {
  const [issueKey, setIssueKey] = useState(() => crypto.randomUUID());
  const router = useRouter(),
    owner = data.user.role === "OWNER",
    manager = ["OWNER", "MANAGER"].includes(data.user.role);
  const [result, setResult] = useState(data.marketing),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<{ kind: string; row?: Row } | null>(null),
    [search, setSearch] = useState(""),
    [report, setReport] = useState("Campaign performance"),
    [start, setStart] = useState(dubaiDate().slice(0, 7) + "-01"),
    [end, setEnd] = useState(dubaiDate());
  const query = `/api/marketing?branch=${branch}&start=${start}&end=${end}`;
  const reload = async () => {
    const r = await fetch(query);
    if (r.ok) setResult(await r.json());
    else setError("Marketing records are unavailable");
  };
  useEffect(() => {
    let cancelled = false;
    fetch(query).then(async (r) => {
      if (r.ok && !cancelled) {
        setResult(await r.json());
        setError("");
      } else if (!cancelled) setError(await r.text());
    });
    return () => {
      cancelled = true;
    };
  }, [branch, data.marketing, start, end]);
  async function mutate(action: string, value: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, data: value }),
        }),
        v = await r.json();
      if (!r.ok) throw new Error(v.error);
      setModal(null);
      await reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (modal?.kind === "voucherIssue") setIssueKey(crypto.randomUUID());
  }, [modal]);
  if (!result) return <p>Loading marketing records…</p>;
  const campaigns = result.campaigns as Row[],
    customers = (data.crm?.customers ?? []).filter((c: Row) => c.active),
    branches = data.branches as Row[];
  const table = (headers: string[], rows: React.ReactNode[][]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>No records in this view.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      v = Object.fromEntries(f) as Row;
    const kind = modal!.kind;
    if (kind === "campaign") {
      v.branchIds = f.getAll("branchIds");
      v.serviceIds = f.getAll("serviceIds");
      for (const k of [
        "expiryDays",
        "inactivityDays",
        "maxPerCustomer",
        "maxRedemptions",
      ])
        v[k] = Number(v[k]);
      v.active = f.has("active");
      v.templateApproved = f.has("templateApproved");
      if (!v.id) delete v.id;
    }
    if (kind === "marketingConfig")
      for (const k of ["deliveryEnabled", "emailEnabled", "whatsappEnabled"])
        v[k] = f.has(k);
    if (kind === "deliveryResolve") v.notSent = f.has("notSent");
    await mutate(kind, v);
  }
  const today = dubaiDate(),
    defaults = {
      name: "",
      code: "",
      kind: "PROMOTION",
      active: false,
      branchIds:
        branch === "all"
          ? branches.filter((b) => b.active).map((b) => b.id)
          : [branch],
      serviceIds: [],
      startDate: today,
      endDate: today.slice(0, 4) + "-12-31",
      discountKind: "PERCENT",
      discountValue: "10",
      minimumSpend: "0",
      expiryDays: 30,
      threshold: "5",
      inactivityDays: 30,
      maxPerCustomer: 1,
      maxRedemptions: 1000,
      channel: "PREFERRED",
      message:
        "Hello {name}, your Protune voucher is {code}. Valid until {expiry}. {offer} {unsubscribe}",
      whatsappTemplate: "",
      templateLanguage: "en",
      templateApproved: false,
      marketingCost: "0",
    };
  const expiring = result.vouchers.filter(
    (v: Row) =>
      v.status === "ISSUED" &&
      new Date(v.expiresAt).getTime() > Date.now() &&
      new Date(v.expiresAt).getTime() <= Date.now() + 7 * 86400000,
  ).length;
  const r: Row = modal?.row ?? defaults;
  const input = (key: string, label: string, type = "text", value?: any) => (
    <label>
      {label}
      <input
        name={key}
        type={type}
        defaultValue={value ?? r[key] ?? ""}
        required={!["whatsappTemplate", "emailFrom"].includes(key)}
        {...(type === "number"
          ? {
              min: 0,
              step: [
                "expiryDays",
                "inactivityDays",
                "maxPerCustomer",
                "maxRedemptions",
              ].includes(key)
                ? 1
                : "0.01",
            }
          : {})}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    options: { id: string; name: string }[],
    value?: string,
  ) => (
    <label>
      {label}
      <select
        name={key}
        defaultValue={value ?? r[key] ?? options[0]?.id}
        required
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  const checkbox = (key: string, label: string, value?: boolean) => (
    <label className="checkbox">
      <input type="checkbox" name={key} defaultChecked={value ?? !!r[key]} />
      {label}
    </label>
  );
  const campaignChoices = campaigns
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, name: c.name }));
  return (
    <div className="ops-workspace">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CUSTOMER GROWTH</span>
            <h2>Promotions & rewards</h2>
            <p>
              One-use digital vouchers, loyal customers, and consent-based
              return visits.
            </p>
          </div>
          <div className="ops-actions">
            {owner && (
              <>
                <button
                  className="primary"
                  onClick={() => setModal({ kind: "campaign" })}
                >
                  New campaign
                </button>
                <button
                  disabled={busy}
                  onClick={() => mutate("marketingRun", {})}
                >
                  Evaluate rewards
                </button>
                <button
                  onClick={() =>
                    setModal({ kind: "marketingConfig", row: result.config })
                  }
                >
                  Delivery settings
                </button>
              </>
            )}
            {manager && (
              <>
                <button onClick={() => setModal({ kind: "voucherIssue" })}>
                  Issue voucher
                </button>
                <button onClick={() => setModal({ kind: "referral" })}>
                  Register referral
                </button>
              </>
            )}
          </div>
        </div>
        <p className="note">
          Rewards qualify after full payment. Campaign rules remain fixed after
          issuance; create a new campaign to change them. New profiles begin
          opted out. Sample messages are suppressed.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Campaigns</h2>
        </div>
        {table(
          ["Campaign", "Offer / rule", "Validity", "Status", ""],
          campaigns.map((c) => [
            <>
              <strong>{c.name}</strong>
              <small>
                {c.code} · {c.kind.replaceAll("_", " ")}
              </small>
            </>,
            <>
              {offerText(c as any)}
              <small>
                {c.kind === "REACTIVATION"
                  ? `${c.inactivityDays} days away`
                  : c.kind === "LOYALTY_VISITS"
                    ? `${c.threshold} paid visits per reward`
                    : c.kind === "LOYALTY_SPEND"
                      ? `${money(c.threshold)} eligible net spending per reward`
                      : c.kind === "REFERRAL"
                        ? `First paid invoice ≥ ${money(c.threshold)}`
                        : c.kind === "NEXT_VISIT"
                          ? `Paid invoice ≥ ${money(c.threshold)}`
                          : "Checkout code or issued voucher"}{" "}
                · Limit {c.maxPerCustomer} per customer
              </small>
            </>,
            `${c.startDate} — ${c.endDate}`,
            c.active ? "Active" : "Paused",
            owner ? (
              <div className="ops-actions">
                <button onClick={() => setModal({ kind: "campaign", row: c })}>
                  Edit
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    mutate("campaignStatus", { id: c.id, active: !c.active })
                  }
                >
                  {c.active ? "Pause" : "Activate"}
                </button>
              </div>
            ) : (
              ""
            ),
          ]),
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Digital vouchers</h2>
          <input
            aria-label="Search vouchers"
            placeholder="Code or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {table(
          [
            "Voucher",
            "Customer",
            "Offer",
            "Expiry",
            "State / delivery",
            "Invoice",
            "",
          ],
          result.vouchers
            .filter((v: Row) =>
              `${v.code} ${v.customer.name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((v: Row) => [
              <>
                <a href={"/voucher/" + v.code} target="_blank" rel="noreferrer">
                  {v.code}
                </a>
                <small>{v.sample ? "SAMPLE · Fictional" : ""}</small>
              </>,
              v.customer.name,
              offerText(v.rules),
              dubaiDate(new Date(v.expiresAt)),
              <>
                {voucherState(v as any)}
                <small>
                  {v.delivery?.status ?? ""} {v.delivery?.reason ?? ""}
                </small>
              </>,
              v.redemption ? (
                <>
                  <a
                    href={"/receipt/" + v.redemption.saleId}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {v.redemption.number}
                  </a>
                  <small>
                    {v.redemption.voidedAt
                      ? "Cancelled redemption"
                      : money(v.redemption.discount)}
                  </small>
                </>
              ) : (
                "Unused"
              ),
              manager && v.status === "ISSUED" ? (
                <button
                  disabled={busy}
                  onClick={() => setModal({ kind: "voucherVoid", row: v })}
                >
                  Revoke
                </button>
              ) : (
                ""
              ),
            ]),
        )}
      </section>
      {manager && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Campaign performance</h2>
              <p>
                Selected dates and authorized branches. Revenue already includes
                discounts.
              </p>
            </div>
            <div className="ops-actions">
              <label>
                From
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Through
                <input
                  type="date"
                  value={end}
                  max={dubaiDate()}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <select
                aria-label="Marketing report"
                value={report}
                onChange={(e) => setReport(e.target.value)}
              >
                {["Campaign performance", "Voucher performance"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              {["csv", "xlsx", "pdf"].map((format) => (
                <a
                  className="button"
                  key={format}
                  href={`${query}&report=${encodeURIComponent(report)}&format=${format}`}
                >
                  {format === "xlsx" ? "Excel" : format.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
          {table(
            [
              "Campaign",
              "Issued",
              "Accepted / delivered",
              "Redeemed / returned",
              "Net revenue",
              "Discounts",
              "Estimated contribution",
            ],
            result.stats.map((s: Row) => [
              campaigns.find((c) => c.id === s.campaignId)?.name,
              s.issued,
              `${s.accepted} / ${s.delivered}`,
              `${s.redeemed} / ${s.returning}`,
              money(s.net),
              money(s.discount),
              money(s.contribution),
            ]),
          )}
          <p className="note">
            Estimated contribution deducts invoice direct costs and campaign
            full budget allocated equally to configured branches, even for
            shorter periods. General overhead is excluded. These attributed
            results do not measure incremental lift. “Accepted” means provider
            acceptance; “delivered” requires a verified status event.
          </p>
        </section>
      )}
      {manager && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loyalty activity</h2>
              <p>
                Paid activity within the program dates and your selected
                branches. Automatic rewards use the full configured branch
                scope.
              </p>
            </div>
          </div>
          {table(
            [
              "Customer",
              "Program",
              "Eligible progress",
              "Threshold",
              "Rewards issued",
            ],
            (result.progress ?? []).map((p: Row) => [
              p.customerName,
              campaigns.find((c) => c.id === p.campaignId)?.name,
              p.kind === "LOYALTY_VISITS"
                ? Number(p.value) + " paid visits"
                : money(p.value),
              p.kind === "LOYALTY_VISITS"
                ? p.threshold + " visits"
                : money(p.threshold),
              p.issued,
            ]),
          )}
        </section>
      )}
      {manager && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Referral activity</h2>
          </div>
          {table(
            ["Campaign", "Referrer", "New customer", "State"],
            result.referrals.map((f: Row) => [
              campaigns.find((c) => c.id === f.campaignId)?.name,
              f.referrer.name,
              f.referred.name,
              f.qualifiedSaleId
                ? "Reward issued after first payment"
                : "Awaiting first qualifying paid invoice",
            ]),
          )}
        </section>
      )}
      {owner && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Delivery queue</h2>
              <p>
                {result.config?.deliveryEnabled
                  ? "Live delivery enabled"
                  : "Delivery disabled"}{" "}
                · Email{" "}
                {result.readiness?.emailReady
                  ? "configured"
                  : "needs credentials"}{" "}
                · WhatsApp{" "}
                {result.readiness?.whatsappReady
                  ? "configured"
                  : "needs credentials"}
              </p>
            </div>
            <button
              disabled={busy || !result.config?.deliveryEnabled}
              onClick={async () => {
                setBusy(true);
                try {
                  const response = await fetch("/api/marketing/dispatch", {
                    method: "POST",
                  });
                  if (!response.ok)
                    throw new Error("Delivery processing failed");
                  await reload();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Process delivery queue
            </button>
          </div>
          {table(
            ["Voucher", "Channel", "Status", "Attempts", "Detail", ""],
            result.vouchers
              .filter((v: Row) => v.delivery)
              .map((v: Row) => [
                v.code,
                v.delivery.channel,
                v.delivery.status,
                v.delivery.attempts,
                v.delivery.reason,
                ["FAILED", "BLOCKED"].includes(v.delivery.status) ? (
                  <button
                    onClick={() =>
                      setModal({ kind: "deliveryRetry", row: v.delivery })
                    }
                  >
                    Retry
                  </button>
                ) : v.delivery.status === "UNKNOWN" ? (
                  <button
                    onClick={() =>
                      setModal({ kind: "deliveryResolve", row: v.delivery })
                    }
                  >
                    Resolve uncertain send
                  </button>
                ) : (
                  ""
                ),
              ]),
          )}
        </section>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Marketing dialog"
          >
            <div className="modal-heading">
              <h2>
                {modal.kind === "campaign"
                  ? modal.row
                    ? "Edit campaign"
                    : "New campaign"
                  : modal.kind === "marketingConfig"
                    ? "Delivery settings"
                    : modal.kind === "voucherIssue"
                      ? "Issue digital voucher"
                      : modal.kind === "referral"
                        ? "Register referral"
                        : modal.kind === "voucherVoid"
                          ? "Revoke voucher"
                          : "Delivery review"}
              </h2>
              <button
                aria-label="Close marketing dialog"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>
            <form key={modal.kind + (modal.row?.id ?? "new")} onSubmit={submit}>
              {modal.row?.id && (
                <input type="hidden" name="id" value={modal.row.id} />
              )}
              {modal.kind === "campaign" ? (
                <>
                  {input("name", "Campaign name")}
                  {input("code", "Checkout promotion code")}
                  {select(
                    "kind",
                    "Reward trigger",
                    [
                      "PROMOTION",
                      "NEXT_VISIT",
                      "LOYALTY_VISITS",
                      "LOYALTY_SPEND",
                      "REFERRAL",
                      "REACTIVATION",
                    ].map((id) => ({ id, name: id.replaceAll("_", " ") })),
                  )}
                  <fieldset>
                    <legend>Valid branches</legend>
                    {branches
                      .filter((b) => b.active)
                      .map((b) => (
                        <label className="checkbox" key={b.id}>
                          <input
                            name="branchIds"
                            type="checkbox"
                            value={b.id}
                            defaultChecked={r.branchIds.includes(b.id)}
                          />
                          {b.name}
                        </label>
                      ))}
                  </fieldset>
                  <fieldset>
                    <legend>Eligible services · leave clear for all</legend>
                    {data.services
                      .filter((s: Row) => s.active)
                      .map((s: Row) => (
                        <label className="checkbox" key={s.id}>
                          <input
                            type="checkbox"
                            name="serviceIds"
                            value={s.id}
                            defaultChecked={r.serviceIds.includes(s.id)}
                          />
                          {s.name}
                        </label>
                      ))}
                  </fieldset>
                  {input("startDate", "Start date (Dubai)", "date")}
                  {input("endDate", "End date (Dubai)", "date")}
                  {select(
                    "discountKind",
                    "Reward",
                    ["PERCENT", "FIXED", "FREE_SERVICE"].map((id) => ({
                      id,
                      name:
                        id === "PERCENT"
                          ? "Percentage off"
                          : id === "FIXED"
                            ? "Fixed AED discount"
                            : "One free eligible service",
                    })),
                  )}
                  {input(
                    "discountValue",
                    "Discount value (% or AED; ignored for free service)",
                    "number",
                  )}
                  {input(
                    "minimumSpend",
                    "Minimum subtotal before discount (AED)",
                    "number",
                  )}
                  {input(
                    "threshold",
                    "Reward threshold (visits, eligible net AED, or qualifying invoice AED)",
                    "number",
                  )}
                  {input(
                    "inactivityDays",
                    "Reactivation inactivity days",
                    "number",
                  )}
                  {input("expiryDays", "Voucher expiry days", "number")}
                  {input(
                    "maxPerCustomer",
                    "Maximum issued / redeemed per customer",
                    "number",
                  )}
                  {input(
                    "maxRedemptions",
                    "Maximum campaign vouchers",
                    "number",
                  )}
                  {input(
                    "marketingCost",
                    "Total campaign budget (AED)",
                    "number",
                  )}
                  {select(
                    "channel",
                    "Delivery channel",
                    ["PREFERRED", "EMAIL", "WHATSAPP"].map((id) => ({
                      id,
                      name: id,
                    })),
                  )}
                  <label>
                    Email message
                    <textarea
                      name="message"
                      required
                      defaultValue={r.message}
                    />
                  </label>
                  <p className="note">
                    Placeholders:{" "}
                    {"{name}, {code}, {expiry}, {offer}, {unsubscribe}"}. Code
                    and unsubscribe are required. WhatsApp uses your approved
                    template with these five body parameters in this order.
                  </p>
                  {input("whatsappTemplate", "Approved WhatsApp template name")}
                  {input("templateLanguage", "Template language (en or en_US)")}
                  {checkbox(
                    "templateApproved",
                    "I verified this template is approved by WhatsApp",
                  )}
                  {checkbox("active", "Campaign active")}
                </>
              ) : modal.kind === "marketingConfig" ? (
                <>
                  {checkbox("deliveryEnabled", "Enable live delivery")}
                  {checkbox("emailEnabled", "Enable email")}
                  {input("emailFrom", "Verified sender email", "email")}
                  {checkbox("whatsappEnabled", "Enable WhatsApp")}
                  <p className="note">
                    Credentials are stored only in secure server configuration.
                    Configure the public HTTPS origin and provider keys before
                    enabling live delivery. Run the background marketing worker
                    for automatic evaluations and delivery. Sample profiles
                    never receive messages.
                  </p>
                </>
              ) : modal.kind === "voucherIssue" || modal.kind === "referral" ? (
                <>
                  <input type="hidden" name="requestKey" value={issueKey} />
                  {select(
                    "campaignId",
                    "Campaign",
                    campaignChoices.filter(
                      (c) =>
                        campaigns.find((x) => x.id === c.id)?.kind ===
                        (modal.kind === "referral" ? "REFERRAL" : "PROMOTION"),
                    ),
                  )}
                  {select(
                    "branchId",
                    "Branch",
                    branches
                      .filter((b) => b.active)
                      .map((b) => ({ id: b.id, name: b.name })),
                    branch === "all" ? undefined : branch,
                  )}
                  {modal.kind === "voucherIssue" ? (
                    select(
                      "customerId",
                      "Customer",
                      customers.map((c: Row) => ({ id: c.id, name: c.name })),
                    )
                  ) : (
                    <>
                      {select(
                        "referrerId",
                        "Referrer",
                        customers.map((c: Row) => ({ id: c.id, name: c.name })),
                      )}
                      {select(
                        "referredId",
                        "New customer",
                        customers.map((c: Row) => ({ id: c.id, name: c.name })),
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {input("reason", "Reason / provider evidence")}
                  {modal.kind === "deliveryResolve" &&
                    checkbox(
                      "notSent",
                      "Provider evidence confirms this message was never accepted",
                      false,
                    )}
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button type="button" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
