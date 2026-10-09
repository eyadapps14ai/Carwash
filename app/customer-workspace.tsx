"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Users, Car, Download, CalendarClock } from "lucide-react";
import { money, D, dubaiDate } from "@/lib/finance";
import { customerReportRows } from "@/lib/crm";
type Row = Record<string, any>;
export default function CustomerWorkspace({
  data,
  branch,
  date,
}: {
  data: Row;
  branch: string;
  date: string;
}) {
  const router = useRouter(),
    crm = data.crm,
    owner = data.user.role === "OWNER",
    finance = ["OWNER", "MANAGER"].includes(data.user.role);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [modal, setModal] = useState<{ kind: string; row?: Row } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [start, setStart] = useState(date.slice(0, 7) + "-01"),
    [branchId, setBranchId] = useState(
      branch === "all" ? data.branches[0]?.id : branch,
    ),
    [reportType, setReportType] = useState("Customer spending"),
    [includeInactive, setInactive] = useState(false),
    [linkType, setLinkType] = useState("SALE");
  const customers = (crm?.customers ?? []).filter(
      (c: Row) =>
        branch === "all" || c.branches.some((b: Row) => b.branchId === branch),
    ),
    customer = customers.find((c: Row) => c.id === selected),
    branchName = (id: string) =>
      data.branches.find((b: Row) => b.id === id)?.name ?? id;
  function open(kind: string, row?: Row) {
    setError("");
    setModal({ kind, row });
    setBranchId(
      row?.branchId ??
        customer?.branches[0]?.branchId ??
        (branch === "all" ? data.branches[0]?.id : branch),
    );
    setLinkType("SALE");
  }
  async function mutate(action: string, values: Row) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, data: values }),
        }),
        result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setModal(null);
      setNotice("Saved successfully");
      if (action === "customer") setSelected(result.id);
      router.refresh();
      setTimeout(() => setNotice(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    const f = new FormData(e.currentTarget),
      v = Object.fromEntries(f) as Row;
    v.requestKey = crypto.randomUUID();
    const row = modal.row;
    if (modal.kind === "customer") {
      if (row) v.id = row.id;
      v.active = finance ? f.get("active") === "on" : true;
      v.notes = v.notes ?? "";
      v.branchId = branchId;
    }
    if (modal.kind === "vehicle") {
      v.customerId = customer?.id;
      if (row) v.id = row.id;
      v.year = v.year ? Number(v.year) : null;
      v.active = f.get("active") === "on";
    }
    if (modal.kind === "customerConsent") {
      v.id = customer?.id;
      v.email = f.get("email") === "on";
      v.whatsApp = f.get("whatsApp") === "on";
      v.optOut = !(v.email || v.whatsApp);
    }
    if (modal.kind === "customerBranches") {
      v.id = customer?.id;
      v.branchIds = f.getAll("branchIds");
    }
    if (modal.kind === "recommendation") {
      v.customerId = customer?.id;
      v.branchId = branchId;
      v.vehicleId = v.vehicleId || null;
      if (row) v.id = row.id;
    }
    if (modal.kind === "linkCustomer") {
      v.customerId = customer?.id;
      v.vehicleId = v.vehicleId || null;
      v.type = linkType;
    }
    mutate(modal.kind, v);
  }
  const table = (heads: string[], rows: React.ReactNode[][]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={heads.length} className="empty">
                No records match this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const scope = (rows: Row[]) =>
      rows.filter((r) => branch === "all" || r.branchId === branch),
    field = (
      label: string,
      name: string,
      value = "",
      type = "text",
      required = true,
    ) => (
      <label>
        {label}
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={type === "text" ? 200 : undefined}
        />
      </label>
    );
  const branchSelect = (allowed?: Row[]) => (
    <label>
      Branch
      <select
        name="branchId"
        value={branchId}
        onChange={(e) => setBranchId(e.target.value)}
      >
        {data.branches
          .filter(
            (b: Row) =>
              b.active &&
              (!allowed || allowed.some((c) => c.branchId === b.id)),
          )
          .map((b: Row) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
    </label>
  );
  const vehicleSelect = () => (
    <label>
      Vehicle
      <select name="vehicleId" defaultValue={modal?.row?.vehicleId ?? ""}>
        <option value="">Customer only / all vehicles</option>
        {customer?.vehicles.map((v: Row) => (
          <option value={v.id} key={v.id}>
            {v.plate} · {v.make} {v.model}
          </option>
        ))}
      </select>
    </label>
  );
  const exports = (type = reportType) => (
    <div className="ops-export">
      {["csv", "xlsx", "pdf"].map((format) => (
        <a
          className="secondary"
          key={format}
          href={`/api/crm?${new URLSearchParams({ branch, start, end: date, format, report: type, ...(customer ? { customer: customer.id } : {}) })}`}
        >
          <Download size={14} />
          {format === "xlsx" ? "Excel" : format.toUpperCase()}
        </a>
      ))}
    </div>
  );
  if (!crm?.enabled)
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Customer management is optional</h2>
            <p>
              Enable profiles, registered vehicles, and linked visit history
              when needed.
            </p>
          </div>
          {owner && (
            <button
              disabled={busy}
              className="primary"
              onClick={() => mutate("crmSettings", { crmEnabled: true })}
            >
              Enable customer management
            </button>
          )}
        </div>
        <div className="job-detail-body">
          <p>
            Walk-in sales and workshop jobs continue to work. Existing customer
            links are preserved while the directory is disabled.
          </p>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    );
  const report = customerReportRows(
    customers.map((c: Row) => ({ ...c, sales: scope(c.sales) })),
    start,
    date,
  );
  return (
    <div className="ops-workspace crm-workspace">
      <div className="finance-intro">
        <div>
          <span className="eyebrow">CUSTOMER RELATIONSHIPS</span>
          <p>
            Profiles, vehicles, and linked visits · Authorized branches only
          </p>
        </div>
        <div className="ops-actions">
          {owner && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => mutate("crmSettings", { crmEnabled: false })}
            >
              Disable directory
            </button>
          )}
          <button className="primary" onClick={() => open("customer")}>
            <Plus size={16} />
            New customer
          </button>
        </div>
      </div>
      {error && !modal && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="ops-summary">
        <div>
          <Users />
          <span>Customer profiles</span>
          <strong>{customers.filter((c: Row) => c.active).length}</strong>
        </div>
        <div>
          <Car />
          <span>Registered vehicles</span>
          <strong>
            {customers.reduce(
              (n: number, c: Row) =>
                n + c.vehicles.filter((v: Row) => v.active).length,
              0,
            )}
          </strong>
        </div>
        <div>
          <CalendarClock />
          <span>Open recommendations</span>
          <strong>
            {customers.reduce(
              (n: number, c: Row) =>
                n +
                scope(c.recommendations ?? []).filter(
                  (r: Row) => r.status === "OPEN",
                ).length,
              0,
            )}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Customer directory</h2>
            <p>Search name, mobile number, email, or vehicle plate.</p>
          </div>
          <div className="ops-actions">
            <input
              aria-label="Search customers"
              placeholder="Name, mobile or plate"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setInactive(e.target.checked)}
              />
              Include inactive
            </label>
          </div>
        </div>
        {table(
          [
            "Customer",
            "Mobile / email",
            "Vehicles",
            "Branches",
            "Preference / consent",
            "",
          ],
          customers
            .filter(
              (c: Row) =>
                (includeInactive || c.active) &&
                `${c.name} ${c.mobile} ${c.email} ${c.vehicles.map((v: Row) => v.plate).join(" ")}`
                  .replace(/[\s()-]/g, "")
                  .toLowerCase()
                  .includes(search.replace(/[\s()-]/g, "").toLowerCase()),
            )
            .map((c: Row) => [
              <>
                <strong>{c.name}</strong>
                <small>
                  {c.sample
                    ? "SAMPLE · Fictional"
                    : c.active
                      ? "Active"
                      : "Inactive"}
                </small>
              </>,
              <>
                {c.mobile || "No mobile"}
                <small>{c.email}</small>
              </>,
              c.vehicles.map((v: Row) => v.plate).join(", ") || "No vehicles",
              c.branches.map((b: Row) => branchName(b.branchId)).join(", "),
              <>
                {c.preferredChannel}
                <small>
                  {c.marketingOptOut
                    ? "Marketing opted out"
                    : `Permission: ${[c.consentEmail ? "email" : "", c.consentWhatsApp ? "WhatsApp" : ""].filter(Boolean).join(", ") || "none"}`}
                </small>
              </>,
              <button className="link" onClick={() => setSelected(c.id)}>
                View profile →
              </button>,
            ]),
        )}
      </section>
      {customer && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">
                {customer.sample
                  ? "FICTIONAL SAMPLE PROFILE"
                  : "CUSTOMER PROFILE"}
              </span>
              <h2>{customer.name}</h2>
              <p>
                {customer.mobile} · {customer.email} ·{" "}
                {customer.active ? "Active" : "Inactive"}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Close customer profile"
              onClick={() => setSelected("")}
            >
              <X size={20} />
            </button>
          </div>
          <div className="job-detail-body">
            <div className="ops-actions">
              {customer.canEdit && (
                <>
                  <button
                    className="secondary"
                    onClick={() => open("customer", customer)}
                  >
                    Edit profile
                  </button>
                  <button className="secondary" onClick={() => open("vehicle")}>
                    Add vehicle
                  </button>
                  <button
                    className="secondary"
                    onClick={() => open("customerConsent")}
                  >
                    Record consent / opt-out
                  </button>
                </>
              )}
              {owner && (
                <button
                  className="secondary"
                  onClick={() => open("customerBranches")}
                >
                  Branch access
                </button>
              )}
              {finance && (
                <>
                  <button
                    className="secondary"
                    onClick={() => open("recommendation")}
                  >
                    Recommend service
                  </button>
                  <button
                    className="secondary"
                    onClick={() => open("linkCustomer")}
                  >
                    Link historical record
                  </button>
                </>
              )}
            </div>
            {finance && !customer.canEdit && (
              <div className="ops-note">
                This shared profile can be edited by the owner or a manager
                assigned to all its branches. History below remains limited to
                your selected branches.
              </div>
            )}
            {finance && customer.notes && (
              <div className="ops-note">
                <strong>Internal notes</strong>
                <p>{customer.notes}</p>
              </div>
            )}
            <h3>Registered vehicles</h3>
            {table(
              ["Plate", "Vehicle", "Category", "State", ""],
              customer.vehicles.map((v: Row) => [
                v.plate,
                `${v.make} ${v.model} ${v.year ?? ""}`,
                v.category,
                v.active ? "Active" : "Inactive",
                customer.canEdit ? (
                  <button className="link" onClick={() => open("vehicle", v)}>
                    Edit vehicle
                  </button>
                ) : (
                  ""
                ),
              ]),
            )}
            <h3>Service & vehicle history</h3>
            {table(
              [
                "Date",
                "Record",
                "Vehicle / services",
                "Branch",
                "State",
                "Amount / balance",
              ],
              [
                ...scope(customer.sales).map((s: Row) => [
                  dubaiDate(new Date(s.createdAt)),
                  <a className="link" href={`/receipt/${s.id}`} target="_blank">
                    {s.number}
                  </a>,
                  <>
                    {s.plate}
                    <small>{s.lines.map((l: Row) => l.name).join(", ")}</small>
                  </>,
                  branchName(s.branchId),
                  s.status,
                  <>
                    {money(s.total)}
                    <small>
                      {s.status === "COMPLETED"
                        ? `Balance ${money(D(s.total).minus(s.payments.reduce((a: ReturnType<typeof D>, p: Row) => a.plus(p.amount), D(0))))}`
                        : "Cancelled; excluded from spending"}
                    </small>
                  </>,
                ]),
                ...scope(customer.jobs).map((j: Row) => [
                  dubaiDate(new Date(j.createdAt)),
                  j.number,
                  <>
                    {j.plate}
                    <small>{j.requestedWork}</small>
                  </>,
                  branchName(j.branchId),
                  j.status,
                  j.saleId ? "Linked invoice shown above" : "Not invoiced",
                ]),
              ],
            )}
            {finance && (
              <>
                <h3>Recommended services</h3>
                {table(
                  ["Due", "Recommendation", "Vehicle", "Branch", "State", ""],
                  scope(customer.recommendations ?? []).map((r: Row) => [
                    dubaiDate(new Date(r.dueDate)),
                    <>
                      {r.title}
                      <small>{r.notes}</small>
                    </>,
                    customer.vehicles.find((v: Row) => v.id === r.vehicleId)
                      ?.plate ?? "All vehicles",
                    branchName(r.branchId),
                    r.status,
                    <button
                      className="link"
                      onClick={() => open("recommendation", r)}
                    >
                      Update
                    </button>,
                  ]),
                )}
                <h3>Consent history</h3>
                <div className="ops-note">
                  Contact preference does not grant marketing consent. No
                  messages are sent in this phase. Changing a contact revokes
                  its previous channel permission.
                </div>
                {table(
                  ["Date", "Email", "WhatsApp", "Opt-out", "Evidence"],
                  (customer.consentEvents ?? []).map((c: Row) => [
                    new Date(c.createdAt).toLocaleString("en-AE", {
                      timeZone: "Asia/Dubai",
                    }),
                    c.email ? "Permitted" : "Not permitted",
                    c.whatsApp ? "Permitted" : "Not permitted",
                    c.optOut ? "Yes" : "No",
                    c.evidence,
                  ]),
                )}
              </>
            )}
          </div>
        </section>
      )}
      {finance && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Customer spending reports</h2>
              <p>
                {customer ? customer.name : "All authorized customers"} ·
                Invoices issued {start} to {date}
              </p>
            </div>
            <label>
              From
              <input
                type="date"
                value={start}
                max={date}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Report
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option>Customer spending</option>
                <option>Customer history</option>
              </select>
            </label>
            {exports()}
          </div>
          <div className="ops-note">
            Visits count completed invoices once. Cancelled invoices and
            uninvoiced jobs do not add spending. Payments and balances include
            all payments recorded on these invoices, including later
            collections.
          </div>
          {table(
            [
              "Customer",
              "Visits",
              "Net revenue",
              "Invoiced incl. VAT",
              "Paid",
              "Outstanding",
              "Last invoiced visit",
            ],
            report
              .filter((c: Row) => !customer || c.id === customer.id)
              .map((c: Row) => [
                c.name,
                c.visits,
                money(c.net),
                money(c.invoiced),
                money(c.paid),
                money(c.balance),
                c.lastVisit ?? "—",
              ]),
          )}
        </section>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal ops-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-modal-title"
          >
            <div className="modal-heading">
              <h2 id="crm-modal-title">
                {
                  {
                    customer: "Customer profile",
                    vehicle: "Registered vehicle",
                    customerConsent: "Marketing consent / opt-out",
                    customerBranches: "Customer branch access",
                    recommendation: "Recommended service",
                    linkCustomer: "Link existing history",
                  }[modal.kind]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Close customer dialog"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form className="ops-form" onSubmit={submit}>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {modal.kind === "customer" && (
                <>
                  {!modal.row ? (
                    branchSelect()
                  ) : (
                    <p>
                      Profile edits preserve previous invoice and job-card
                      snapshots.
                    </p>
                  )}
                  {field("Customer name", "name", modal.row?.name)}
                  {field(
                    "Mobile (05xxxxxxxx or +country code)",
                    "mobile",
                    modal.row?.mobile ?? "",
                    "text",
                    false,
                  )}
                  {field(
                    "Email",
                    "email",
                    modal.row?.email ?? "",
                    "email",
                    false,
                  )}
                  <label>
                    Preferred contact method
                    <select
                      name="preferredChannel"
                      defaultValue={modal.row?.preferredChannel ?? "NONE"}
                    >
                      {["NONE", "EMAIL", "WHATSAPP", "PHONE"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  {finance && (
                    <label>
                      Internal notes
                      <textarea
                        name="notes"
                        defaultValue={modal.row?.notes ?? ""}
                        maxLength={2000}
                      />
                    </label>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={modal.row?.active ?? true}
                      disabled={!finance}
                    />
                    Active
                  </label>
                  <p>
                    New profiles are opted out of marketing until explicit
                    channel consent is recorded.
                  </p>
                </>
              )}
              {modal.kind === "vehicle" && (
                <>
                  {field(
                    "Plate (include emirate / code)",
                    "plate",
                    modal.row?.plate,
                  )}
                  {field("Make", "make", modal.row?.make ?? "", "text", false)}
                  {field(
                    "Model",
                    "model",
                    modal.row?.model ?? "",
                    "text",
                    false,
                  )}
                  <label>
                    Year
                    <input
                      name="year"
                      type="number"
                      min="1900"
                      max={new Date().getFullYear() + 1}
                      defaultValue={modal.row?.year ?? ""}
                    />
                  </label>
                  <label>
                    Vehicle category
                    <input
                      name="category"
                      list="vehicle-categories"
                      required
                      defaultValue={modal.row?.category ?? "Sedan"}
                    />
                    <datalist id="vehicle-categories">
                      {["Sedan", "SUV", "Van", "Pickup", "Other"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </datalist>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={modal.row?.active ?? true}
                    />
                    Active
                  </label>
                  <p>
                    Vehicles keep their owner and historical links. Archive an
                    old ownership record before creating one for a new owner.
                  </p>
                </>
              )}
              {modal.kind === "customerConsent" && (
                <>
                  <div className="ops-note">
                    Record permissions actually given by this customer. Clear
                    both boxes to record a complete opt-out.
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="email"
                      defaultChecked={customer?.consentEmail}
                    />
                    Customer permits marketing email
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="whatsApp"
                      defaultChecked={customer?.consentWhatsApp}
                    />
                    Customer permits marketing WhatsApp
                  </label>
                  <label>
                    Consent or opt-out evidence
                    <textarea name="evidence" required maxLength={1000} />
                  </label>
                </>
              )}
              {modal.kind === "customerBranches" && (
                <>
                  <p>
                    Only selected branches can find this profile. Existing
                    history prevents removal of its branch.
                  </p>
                  <fieldset>
                    <legend>Authorized branches</legend>
                    {data.branches
                      .filter((b: Row) => b.active)
                      .map((b: Row) => (
                        <label className="check" key={b.id}>
                          <input
                            type="checkbox"
                            name="branchIds"
                            value={b.id}
                            defaultChecked={customer?.branches.some(
                              (c: Row) => c.branchId === b.id,
                            )}
                          />
                          {b.name}
                        </label>
                      ))}
                  </fieldset>
                </>
              )}
              {modal.kind === "recommendation" && (
                <>
                  {branchSelect(customer?.branches)}
                  {vehicleSelect()}
                  {field("Recommended service", "title", modal.row?.title)}
                  {field(
                    "Due date",
                    "dueDate",
                    modal.row?.dueDate
                      ? dubaiDate(new Date(modal.row.dueDate))
                      : date,
                    "date",
                  )}
                  <label>
                    Notes
                    <textarea
                      name="notes"
                      maxLength={2000}
                      defaultValue={modal.row?.notes ?? ""}
                    />
                  </label>
                  <label>
                    Status
                    <select
                      name="status"
                      defaultValue={modal.row?.status ?? "OPEN"}
                    >
                      {["OPEN", "DONE", "CANCELLED"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {modal.kind === "linkCustomer" && (
                <>
                  <div className="ops-note">
                    Link a record you have verified belongs to this customer.
                    Invoice amounts, dates, names and plates remain unchanged. A
                    registered vehicle must match the historical plate.
                  </div>
                  <label>
                    Record type
                    <select
                      value={linkType}
                      onChange={(e) => setLinkType(e.target.value)}
                    >
                      <option value="SALE">Invoice / sale</option>
                      <option value="JOB">Workshop job card</option>
                    </select>
                  </label>
                  <label>
                    Unlinked record
                    <select name="id" required key={linkType}>
                      {(linkType === "SALE"
                        ? crm.unlinkedSales
                        : crm.unlinkedJobs
                      )
                        .filter((r: Row) =>
                          customer?.branches.some(
                            (b: Row) => b.branchId === r.branchId,
                          ),
                        )
                        .map((r: Row) => (
                          <option key={r.id} value={r.id}>
                            {r.number} · {r.plate} · {r.customerName} ·{" "}
                            {branchName(r.branchId)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {vehicleSelect()}
                </>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal(null)}
                >
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
