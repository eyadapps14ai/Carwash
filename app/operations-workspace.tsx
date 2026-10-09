"use client";
import CustomerPicker from "./customer-picker";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  X,
  Package,
  ClipboardList,
  Clock,
  ArrowRightLeft,
  Download,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { D, money, dubaiDate } from "@/lib/finance";
import { jobTransitions, jobStatuses, inventoryUsage } from "@/lib/operations";
type Row = Record<string, any>;
export default function OperationsWorkspace({
  tab,
  data,
  branch,
  date,
}: {
  tab: string;
  data: Row;
  branch: string;
  date: string;
}) {
  const router = useRouter(),
    ops = data.operations,
    finance = ["OWNER", "MANAGER"].includes(data.user.role),
    owner = data.user.role === "OWNER",
    tech = data.user.role === "TECHNICIAN";
  const [modal, setModal] = useState<{ kind: string; row?: Row } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("OPEN"),
    [query, setQuery] = useState(""),
    [start, setStart] = useState(date.slice(0, 7) + "-01"),
    [report, setReport] = useState<Row[]>([]),
    [formBranch, setFormBranch] = useState(
      branch === "all" ? data.branches[0]?.id : branch,
    ),
    [recipeService, setRecipeService] = useState(""),
    [materialRows, setMaterialRows] = useState<Row[]>([]),
    [parts, setParts] = useState<Row[]>([]),
    [linkedCustomer, setLinkedCustomer] = useState<Row | null>(null);
  const scope = (rows: Row[]) =>
      rows.filter((r) => branch === "all" || r.branchId === branch),
    jobs = scope(ops.jobs),
    job = ops.jobs.find((j: Row) => j.id === selected),
    branchName = (id: string) =>
      data.branches.find((b: Row) => b.id === id)?.name ?? id;
  useEffect(() => {
    if (!["Productivity", "Attendance"].includes(tab)) return;
    let live = true;
    fetch(
      `/api/operations?${new URLSearchParams({ branch, start, end: date })}`,
    )
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        if (live) setReport(result.productivity);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [tab, branch, start, date, ops]);
  function open(kind: string, row?: Row) {
    setError("");
    setModal({ kind, row });
    setFormBranch(
      row?.branchId ?? (branch === "all" ? data.branches[0]?.id : branch),
    );
    setParts([]);
    setMaterialRows([]);
    setRecipeService("");
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
      router.refresh();
      if (action === "jobCreate") setSelected(result.id);
      if (action === "jobInvoice")
        window.open(`/receipt/${result.id}`, "_blank");
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
    if (modal.kind === "jobCreate") {
      v.workerIds = f.getAll("workerIds");
      if (!v.estimatedCompletion) delete v.estimatedCompletion;
    }
    if (modal.kind === "jobAssign") {
      v.id = row?.id;
      v.workerIds = f.getAll("workerIds");
    }
    if (modal.kind === "jobQuote") {
      v.id = row?.id;
      v.serviceIds = f.getAll("serviceIds");
      v.parts = parts;
    }
    if (modal.kind === "jobApproval") {
      v.id = row?.id;
      v.quotationId = row?.quotes[0]?.id;
    }
    if (modal.kind === "jobStatus" || modal.kind === "jobTimeStop") {
      v.id = row?.id;
    }
    if (modal.kind === "inventoryItem") {
      if (row) v.id = row.id;
      v.active = f.get("active") === "on";
    }
    if (modal.kind === "serviceMaterials") {
      v.branchId = formBranch;
      v.serviceId = recipeService;
      v.materials = materialRows;
    }
    if (modal.kind === "productivityTarget") {
      v.id = row?.id;
      v.target = Number(v.target);
    }
    if (!v.customerId) delete v.customerId;
    if (!v.vehicleId) delete v.vehicleId;
    mutate(modal.kind, v);
  }
  const table = (headers: string[], rows: React.ReactNode[][]) => (
    <div className="table-scroll">
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
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="empty">
                No records match this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const btn = (label: string, kind: string, row?: Row) => (
    <button className="secondary" onClick={() => open(kind, row)}>
      {label}
    </button>
  );
  const branchSelect = (name = "branchId", fixed = false) => (
    <label>
      Branch
      <select
        name={name}
        value={formBranch}
        onChange={(e) => {
          setFormBranch(e.target.value);
          setRecipeService("");
          setMaterialRows([]);
        }}
        disabled={fixed}
      >
        {data.branches
          .filter((b: Row) => b.active)
          .map((b: Row) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
    </label>
  );
  const itemSelect = (name = "itemId") => (
    <label>
      Inventory item
      <select name={name} required>
        {ops.items
          .filter((i: Row) => i.active)
          .map((i: Row) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.sku} ({i.unit})
            </option>
          ))}
      </select>
    </label>
  );
  const field = (
    label: string,
    name: string,
    value = "",
    type = "text",
    required = true,
    step?: string,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={step}
        maxLength={type === "text" ? 300 : undefined}
      />
    </label>
  );
  const workers = (row?: Row) => (
    <fieldset>
      <legend>Assigned employees</legend>
      {ops.staff
        .filter(
          (s: Row) =>
            s.active && s.branches.some((b: Row) => b.branchId === formBranch),
        )
        .map((s: Row) => (
          <label className="check" key={s.id}>
            <input
              type="checkbox"
              name="workerIds"
              value={s.id}
              defaultChecked={row?.assignments?.some(
                (a: Row) => a.userId === s.id,
              )}
            />
            {s.name}
          </label>
        ))}
    </fieldset>
  );
  const recipe = ops.recipes.find(
    (r: Row) => r.branchId === formBranch && r.serviceId === recipeService,
  );
  const exportLinks = (name: string) => (
    <div className="ops-export">
      {["csv", "xlsx", "pdf"].map((f) => (
        <a
          className="secondary"
          key={f}
          href={`/api/operations?${new URLSearchParams({ branch, start, end: date, report: name, format: f })}`}
        >
          <Download size={14} />
          {f === "xlsx" ? "Excel" : f.toUpperCase()}
        </a>
      ))}
    </div>
  );
  const activeAttendance = ops.attendance.find(
    (a: Row) => a.userId === data.user.id && !a.endedAt,
  );
  return (
    <div className="ops-workspace">
      <div className="finance-intro">
        <div>
          <span className="eyebrow">WORKSHOP OPERATIONS</span>
          <p>Job progress, materials, and recorded working time · Dubai</p>
        </div>
        <div className="ops-actions">
          {["Job cards", "My jobs"].includes(tab) && !tech && (
            <button className="primary" onClick={() => open("jobCreate")}>
              <Plus size={16} />
              New job card
            </button>
          )}
          {tab === "Inventory" && finance && (
            <>
              <button
                className="secondary"
                onClick={() => open("stockTransfer")}
              >
                <ArrowRightLeft size={16} />
                Transfer stock
              </button>
              <button className="primary" onClick={() => open("stockMove")}>
                <Plus size={16} />
                Receive / adjust
              </button>
            </>
          )}
        </div>
      </div>
      {error && !modal && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}
      {["Job cards", "My jobs"].includes(tab) && (
        <>
          <div className="ops-summary">
            <div>
              <ClipboardList />
              <span>Open job cards</span>
              <strong>
                {
                  jobs.filter(
                    (j: Row) =>
                      !["COMPLETED", "DELIVERED", "CANCELLED"].includes(
                        j.status,
                      ),
                  ).length
                }
              </strong>
            </div>
            <div>
              <Clock />
              <span>Awaiting approval / parts</span>
              <strong>
                {
                  jobs.filter((j: Row) =>
                    ["AWAITING_APPROVAL", "AWAITING_PARTS"].includes(j.status),
                  ).length
                }
              </strong>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                {tech
                  ? "Completed workshop jobs"
                  : "Completed, ready to invoice"}
              </span>
              <strong>
                {
                  jobs.filter((j: Row) =>
                    tech
                      ? ["COMPLETED", "DELIVERED"].includes(j.status)
                      : j.status === "COMPLETED" && !j.saleId,
                  ).length
                }
              </strong>
            </div>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {tech ? "Your assigned workshop jobs" : "Garage job cards"}
                </h2>
                <p>
                  Approval applies to the latest quotation revision. Sample
                  cards are fictional.
                </p>
              </div>
              <div className="ops-actions">
                <input
                  aria-label="Search jobs"
                  placeholder="Search job or vehicle"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Job status filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="OPEN">Open jobs</option>
                  <option value="ALL">All statuses</option>
                  {jobStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {table(
              [
                "Job / vehicle",
                "Requested work",
                "Branch",
                "Team",
                "Status",
                "Due",
                "",
              ],
              jobs
                .filter(
                  (j: Row) =>
                    (filter === "ALL" ||
                      (filter === "OPEN" &&
                        !["DELIVERED", "CANCELLED"].includes(j.status)) ||
                      j.status === filter) &&
                    `${j.number} ${j.plate} ${j.customerName ?? ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((j: Row) => [
                  <>
                    <strong>
                      {j.number}
                      {j.sample ? " · SAMPLE" : ""}
                    </strong>
                    <small>
                      {j.plate} · {j.vehicle}
                    </small>
                  </>,
                  j.requestedWork,
                  branchName(j.branchId),
                  j.assignments.map((a: Row) => a.user.name).join(", ") ||
                    "Unassigned",
                  <span className={`job-badge ${j.status.toLowerCase()}`}>
                    {j.status.replaceAll("_", " ")}
                  </span>,
                  j.estimatedCompletion
                    ? dubaiDate(new Date(j.estimatedCompletion))
                    : "—",
                  <button className="link" onClick={() => setSelected(j.id)}>
                    Open card →
                  </button>,
                ]),
            )}
          </section>
          {job && (
            <section className="panel job-detail">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    {job.status.replaceAll("_", " ")}
                  </span>
                  <h2>
                    {job.number} · {job.plate}
                  </h2>
                  <p>
                    {tech
                      ? job.vehicle
                      : `${job.customerName} · ${job.customerPhone || "No phone recorded"} · ${job.vehicle}`}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close job detail"
                  onClick={() => setSelected("")}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="job-detail-body">
                <p>{job.requestedWork}</p>
                <div className="ops-actions">
                  {(jobTransitions[job.status] ?? []).some(
                    (s) =>
                      (data.user.role === "CASHIER"
                        ? ["AWAITING_APPROVAL", "DELIVERED"].includes(s)
                        : !tech) ||
                      (tech &&
                        [
                          "INSPECTION",
                          "IN_PROGRESS",
                          "AWAITING_PARTS",
                          "COMPLETED",
                        ].includes(s)),
                  ) && btn("Update status", "jobStatus", job)}
                  {finance &&
                    !["COMPLETED", "DELIVERED", "CANCELLED"].includes(
                      job.status,
                    ) &&
                    btn("Assign team", "jobAssign", job)}
                  {finance &&
                    [
                      "NEW",
                      "INSPECTION",
                      "QUOTATION",
                      "AWAITING_APPROVAL",
                    ].includes(job.status) &&
                    btn("Revise quotation", "jobQuote", job)}
                  {!tech &&
                    ["QUOTATION", "AWAITING_APPROVAL"].includes(job.status) &&
                    job.quotes[0] &&
                    !job.quotes[0].approval &&
                    btn("Record customer approval", "jobApproval", job)}
                  {(finance || tech) &&
                    job.status === "IN_PROGRESS" &&
                    job.assignments.some(
                      (a: Row) => a.userId === data.user.id,
                    ) &&
                    !ops.times.some(
                      (t: Row) => t.userId === data.user.id && !t.endedAt,
                    ) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => mutate("jobTimeStart", { id: job.id })}
                      >
                        Start my timer
                      </button>
                    )}
                  {job.times
                    .filter((t: Row) => t.userId === data.user.id && !t.endedAt)
                    .map((t: Row) => (
                      <button
                        key={t.id}
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          mutate("jobTimeStop", {
                            id: t.id,
                            note: "Work session completed",
                          })
                        }
                      >
                        Stop my timer
                      </button>
                    ))}
                  {!tech && job.status === "COMPLETED" && !job.saleId && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => mutate("jobInvoice", { id: job.id })}
                    >
                      Generate invoice
                    </button>
                  )}
                  {!tech && job.saleId && (
                    <a
                      className="secondary"
                      href={`/receipt/${job.saleId}`}
                      target="_blank"
                    >
                      View invoice / receipt
                    </a>
                  )}
                </div>
                {job.sale && !tech && (
                  <div className="ops-note">
                    Invoice {money(job.sale.total)} · Outstanding{" "}
                    {money(
                      D(job.sale.total).minus(
                        job.sale.payments.reduce(
                          (a: ReturnType<typeof D>, p: Row) => a.plus(p.amount),
                          D(0),
                        ),
                      ),
                    )}
                    . Record partial payments in Sales.
                  </div>
                )}
                {job.quotes.length > 0 ? (
                  <>
                    <h3>Quotation history</h3>
                    {job.quotes.map((q: Row) => (
                      <div key={q.id} className="quote-card">
                        <div>
                          <strong>Revision {q.version}</strong>
                          <span className="job-badge">
                            {q.approval
                              ? "Customer approval recorded"
                              : "Approval pending"}
                          </span>
                          {!tech && <strong>{money(q.total)} incl. VAT</strong>}
                        </div>
                        {table(
                          tech
                            ? ["Work / parts"]
                            : finance
                              ? [
                                  "Work / parts",
                                  "Selling price",
                                  "Estimated cost",
                                ]
                              : ["Work / parts", "Selling price"],
                          q.lines.map((l: Row) =>
                            tech
                              ? [
                                  <>
                                    {l.name}
                                    {l.materials?.length > 0 && (
                                      <small>
                                        {l.materials
                                          .map(
                                            (m: Row) =>
                                              `${m.name} × ${m.quantity}`,
                                          )
                                          .join(", ")}
                                      </small>
                                    )}
                                  </>,
                                ]
                              : finance
                                ? [l.name, money(l.price), money(l.cost)]
                                : [l.name, money(l.price)],
                          ),
                        )}
                        {!tech && (
                          <p>
                            Discount {money(q.discount)} · VAT {money(q.vat)}
                            {q.approval &&
                              ` · ${q.approval.method.replaceAll("_", " ")}: ${q.approval.evidence}`}
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="ops-note">
                    No quotation yet. Inspect the vehicle and prepare work and
                    parts for customer approval.
                  </div>
                )}
                <h3>Recorded technician sessions</h3>
                {table(
                  ["Employee", "Started", "Ended", "Note", ""],
                  job.times.map((t: Row) => [
                    t.user.name,
                    new Date(t.startedAt).toLocaleString("en-AE", {
                      timeZone: "Asia/Dubai",
                    }),
                    t.endedAt
                      ? new Date(t.endedAt).toLocaleString("en-AE", {
                          timeZone: "Asia/Dubai",
                        })
                      : "Timer running",
                    t.note,
                    finance && !t.endedAt
                      ? btn("Stop timer", "jobTimeStop", t)
                      : "",
                  ]),
                )}
                <h3>Progress history</h3>
                <div className="job-events">
                  {job.events.map((e: Row) => (
                    <div key={e.id}>
                      <span>{e.status.replaceAll("_", " ")}</span>
                      <p>{e.note}</p>
                      <small>
                        {new Date(e.createdAt).toLocaleString("en-AE", {
                          timeZone: "Asia/Dubai",
                        })}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {tech && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Completed checkout assignments</h2>
              </div>
              {table(
                ["Vehicle", "Date", "Services"],
                scope(data.sales).map((s: Row) => [
                  s.plate,
                  dubaiDate(new Date(s.createdAt)),
                  s.lines.map((l: Row) => l.name).join(", "),
                ]),
              )}
            </section>
          )}
        </>
      )}
      {tab === "Inventory" && finance && (
        <>
          <div className="ops-summary">
            <div>
              <Package />
              <span>Stock value · weighted cost</span>
              <strong>
                {money(
                  scope(ops.stocks).reduce(
                    (v: ReturnType<typeof D>, s: Row) =>
                      v.plus(D(s.quantity).mul(s.unitCost)),
                    D(0),
                  ),
                )}
              </strong>
            </div>
            <div>
              <AlertTriangle />
              <span>At / below reorder level</span>
              <strong>
                {
                  scope(ops.stocks).filter(
                    (s: Row) =>
                      s.item.active && D(s.quantity).lte(s.reorderLevel),
                  ).length
                }
              </strong>
            </div>
            <div>
              <ArrowRightLeft />
              <span>Ledger movements</span>
              <strong>{scope(ops.movements).length}</strong>
            </div>
          </div>
          <div className="ops-note">
            Receiving stock records its value. Record supplier cash payments
            separately in the cash journal. Consumption becomes service cost
            once; inventory receipts and transfers are not operating expenses.
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Branch stock & reorder alerts</h2>
                <p>
                  Quantity is never allowed below zero. Unit costs use weighted
                  average.
                </p>
              </div>
              {btn("Configure stock location / alert", "stockSettings")}
            </div>
            {table(
              [
                "Item / SKU",
                "Branch",
                "Quantity",
                "Unit cost",
                "Stock value",
                "Reorder / location",
                "State",
              ],
              scope(ops.stocks).map((s: Row) => [
                <>
                  <strong>{s.item.name}</strong>
                  <small>
                    {s.item.sku} · {s.item.unit}
                  </small>
                </>,
                branchName(s.branchId),
                Number(s.quantity).toLocaleString("en-AE", {
                  maximumFractionDigits: 4,
                }),
                money(s.unitCost),
                money(D(s.quantity).mul(s.unitCost)),
                `${s.reorderLevel} · ${s.location || "Not set"}`,
                D(s.quantity).lte(s.reorderLevel) ? (
                  <span className="job-badge awaiting_parts">Reorder</span>
                ) : (
                  "In stock"
                ),
              ]),
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Item catalog</h2>
                <p>
                  Shared item definitions; quantities remain separate by branch.
                </p>
              </div>
              {owner && btn("Add item", "inventoryItem")}
            </div>
            {table(
              ["Item", "SKU", "Category", "Unit", "Supplier", "State", ""],
              ops.items.map((i: Row) => [
                i.name,
                i.sku,
                i.category,
                i.unit,
                i.supplier,
                i.active ? "Active" : "Inactive",
                owner ? btn("Edit", "inventoryItem", i) : "",
              ]),
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Service material recipes</h2>
                <p>
                  Map stock quantities and select the estimated components they
                  replace.
                </p>
              </div>
              {btn("Configure recipe", "serviceMaterials")}
            </div>
            {table(
              ["Branch", "Service", "Stock materials"],
              scope(ops.recipes)
                .filter((r: Row) => r.materials.length)
                .map((r: Row) => [
                  branchName(r.branchId),
                  r.name,
                  r.materials
                    .map(
                      (m: Row) =>
                        `${ops.items.find((i: Row) => i.id === m.itemId)?.name ?? m.itemId} × ${m.quantity}${m.replaceCostNames.length ? ` (replaces ${m.replaceCostNames.join(", ")})` : ""}`,
                    )
                    .join("; "),
                ]),
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Material consumption & cost</h2>
                <p>
                  Completed-service stock usage · {start} to {date}
                </p>
              </div>
              {exportLinks("Inventory usage")}
            </div>
            {table(
              ["Item / SKU", "Branch", "Quantity used", "Consumed cost"],
              inventoryUsage(
                scope(ops.movements).filter(
                  (m: Row) =>
                    dubaiDate(new Date(m.createdAt)) >= start &&
                    dubaiDate(new Date(m.createdAt)) <= date,
                ) as any,
              ).map((r) => [
                `${r.name} · ${r.sku}`,
                branchName(r.branchId),
                `${Number(r.quantity)} ${r.unit}`,
                money(r.cost),
              ]),
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Inventory movement & usage</h2>
                <p>
                  Transfers have paired source/destination entries and a shared
                  reference.
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
              {exportLinks("Inventory movement")}
            </div>
            {table(
              [
                "Date",
                "Item",
                "Branch",
                "Type",
                "Quantity",
                "Value",
                "Reference / reason",
              ],
              scope(ops.movements)
                .filter(
                  (m: Row) =>
                    dubaiDate(new Date(m.createdAt)) >= start &&
                    dubaiDate(new Date(m.createdAt)) <= date,
                )
                .map((m: Row) => [
                  dubaiDate(new Date(m.createdAt)),
                  m.item.name,
                  branchName(m.branchId),
                  m.kind.replaceAll("_", " "),
                  String(m.quantity),
                  money(m.value),
                  <>
                    {m.reference}
                    <small>{m.note}</small>
                  </>,
                ]),
            )}
          </section>
        </>
      )}
      {tab === "Productivity" && finance && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Employee productivity</h2>
              <p>
                Recorded hours and completed work · {start} to {date}
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
            {exportLinks("Employee productivity")}
          </div>
          <div className="ops-note">
            Invoice revenue is split equally among assigned employees,
            preserving cents. Associated vehicles and services can overlap
            across team members and must not be added together. Hours come from
            recorded timers and attendance, not scheduled payroll hours.
          </div>
          {table(
            [
              "Employee",
              "Open jobs",
              "Completed jobs",
              "Vehicles / washes",
              "Services",
              "Job hours",
              "Attendance hours",
              "Avg. recorded job min.",
              "Allocated revenue",
              "Services / recorded hour",
              "Monthly target",
            ],
            report.map((r) => [
              r.name,
              r.assigned,
              r.completed,
              `${r.vehicles} / ${r.washes}`,
              r.services,
              r.jobHours,
              r.attendanceHours,
              r.averageSessionMinutes ?? "—",
              money(r.revenue),
              <>
                {r.servicesPerHour ?? "—"}
                <small>{r.hoursBasis}</small>
              </>,
              <>
                {r.target
                  ? `${r.services} / ${r.target} (${Math.round((r.services / r.target) * 100)}%)`
                  : "Not set"}
                {owner && (
                  <button
                    className="link"
                    onClick={() => open("productivityTarget", r)}
                  >
                    Edit
                  </button>
                )}
              </>,
            ]),
          )}
        </section>
      )}
      {tab === "Attendance" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Your working time</h2>
                <p>
                  {ops.attendanceEnabled
                    ? "Attendance recording enabled"
                    : "Attendance recording disabled"}{" "}
                  · No payroll postings
                </p>
              </div>
              {owner && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    mutate("operationsSettings", {
                      attendanceEnabled: !ops.attendanceEnabled,
                    })
                  }
                >
                  {ops.attendanceEnabled
                    ? "Disable tracking"
                    : "Enable tracking"}
                </button>
              )}
            </div>
            <div className="job-detail-body">
              <div className="ops-actions">
                {activeAttendance ? (
                  <>
                    <span>
                      Clocked in at{" "}
                      {new Date(activeAttendance.startedAt).toLocaleTimeString(
                        "en-AE",
                        { timeZone: "Asia/Dubai" },
                      )}{" "}
                      · {branchName(activeAttendance.branchId)}
                    </span>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => mutate("attendanceOut", {})}
                    >
                      Clock out
                    </button>
                  </>
                ) : ops.attendanceEnabled ? (
                  <>
                    <select
                      aria-label="Clock-in branch"
                      value={formBranch}
                      onChange={(e) => setFormBranch(e.target.value)}
                    >
                      {data.branches
                        .filter((b: Row) => b.active)
                        .map((b: Row) => (
                          <option value={b.id} key={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        mutate("attendanceIn", { branchId: formBranch })
                      }
                    >
                      Clock in
                    </button>
                  </>
                ) : (
                  <p>Ask the owner to enable attendance tracking.</p>
                )}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {finance
                    ? "Branch attendance records"
                    : "Your attendance records"}
                </h2>
                <p>Open sessions are marked running.</p>
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
            </div>
            {table(
              ["Employee", "Branch", "Started", "Ended"],
              scope(ops.attendance)
                .filter(
                  (a: Row) =>
                    dubaiDate(new Date(a.startedAt)) <= date &&
                    (!a.endedAt || dubaiDate(new Date(a.endedAt)) >= start),
                )
                .map((a: Row) => [
                  a.user.name,
                  branchName(a.branchId),
                  new Date(a.startedAt).toLocaleString("en-AE", {
                    timeZone: "Asia/Dubai",
                  }),
                  a.endedAt
                    ? new Date(a.endedAt).toLocaleString("en-AE", {
                        timeZone: "Asia/Dubai",
                      })
                    : "Running",
                ]),
            )}
          </section>
        </>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal ops-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-modal-title"
          >
            <div className="modal-heading">
              <h2 id="ops-modal-title">
                {
                  {
                    jobCreate: "New job card",
                    jobAssign: "Assign job team",
                    jobQuote: "Quotation revision",
                    jobApproval: "Record customer approval",
                    jobStatus: "Update job progress",
                    jobTimeStop: "Stop job timer with reason",
                    inventoryItem: "Inventory item",
                    stockMove: "Receive or adjust stock",
                    stockTransfer: "Interbranch stock transfer",
                    stockSettings: "Reorder level & location",
                    serviceMaterials: "Service material recipe",
                    productivityTarget: "Monthly service target",
                  }[modal.kind]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Close workshop dialog"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit} className="ops-form">
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {modal.kind === "jobCreate" && (
                <>
                  {branchSelect()}
                  <CustomerPicker
                    crm={data.crm}
                    branchId={formBranch}
                    onSelect={setLinkedCustomer}
                  />
                  <div key={linkedCustomer?.customer?.id ?? "manual-customer"}>
                    {field(
                      "Customer name",
                      "customerName",
                      linkedCustomer?.customer?.name,
                    )}
                    {field(
                      "Mobile number",
                      "customerPhone",
                      linkedCustomer?.customer?.mobile ?? "",
                      "text",
                      false,
                    )}
                  </div>
                  <div key={linkedCustomer?.vehicle?.id ?? "manual-vehicle"}>
                    {field(
                      "Vehicle plate",
                      "plate",
                      linkedCustomer?.vehicle?.plate,
                    )}
                  </div>
                  {field(
                    "Vehicle make / model / year",
                    "vehicle",
                    "",
                    "text",
                    false,
                  )}
                  <label>
                    Requested work
                    <textarea name="requestedWork" required maxLength={1000} />
                  </label>
                  {field(
                    "Estimated completion date",
                    "estimatedCompletion",
                    "",
                    "date",
                    false,
                  )}
                  {workers()}
                </>
              )}
              {modal.kind === "jobAssign" && workers(modal.row)}
              {modal.kind === "jobQuote" && (
                <>
                  <div className="ops-note">
                    A new revision requires new customer approval. Salaried
                    labor belongs in payroll expenses. Extra labor charges below
                    are customer charges; direct costs must exclude payroll
                    already expensed.
                  </div>
                  <fieldset>
                    <legend>Requested catalog services</legend>
                    {data.services
                      .filter(
                        (s: Row) =>
                          s.active &&
                          s.branches.some(
                            (b: Row) =>
                              b.branchId === modal.row?.branchId && b.active,
                          ),
                      )
                      .map((s: Row) => (
                        <label key={s.id} className="check">
                          <input
                            type="checkbox"
                            name="serviceIds"
                            value={s.id}
                          />
                          {s.name} ·{" "}
                          {money(
                            s.branches.find(
                              (b: Row) => b.branchId === modal.row?.branchId,
                            ).price,
                          )}
                        </label>
                      ))}
                  </fieldset>
                  {field(
                    "Extra labor / work description",
                    "laborName",
                    "Additional labor",
                  )}
                  {field(
                    "Extra labor selling charge (AED)",
                    "laborCharge",
                    "0",
                    "number",
                    true,
                    "0.01",
                  )}
                  {field(
                    "Other direct cost excluding payroll (AED)",
                    "otherCost",
                    "0",
                    "number",
                    true,
                    "0.01",
                  )}
                  {field(
                    "Discount (AED)",
                    "discount",
                    "0",
                    "number",
                    true,
                    "0.01",
                  )}
                  <h3>Additional stock parts</h3>
                  {parts.map((p, i) => (
                    <div className="recipe-row" key={i}>
                      <label>
                        Item
                        <select
                          value={p.itemId}
                          onChange={(e) =>
                            setParts(
                              parts.map((r, j) =>
                                j === i ? { ...r, itemId: e.target.value } : r,
                              ),
                            )
                          }
                        >
                          {ops.items
                            .filter((a: Row) => a.active)
                            .map((a: Row) => (
                              <option key={a.id} value={a.id}>
                                {a.name} · {a.unit}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Quantity
                        <input
                          aria-label={`Part quantity ${i + 1}`}
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          required
                          value={p.quantity}
                          onChange={(e) =>
                            setParts(
                              parts.map((r, j) =>
                                j === i
                                  ? { ...r, quantity: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Total selling charge (AED)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={p.sellingPrice}
                          onChange={(e) =>
                            setParts(
                              parts.map((r, j) =>
                                j === i
                                  ? { ...r, sellingPrice: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setParts(parts.filter((_, j) => j !== i))
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    disabled={!ops.items.some((i: Row) => i.active)}
                    onClick={() =>
                      setParts([
                        ...parts,
                        {
                          itemId: ops.items.find((i: Row) => i.active)?.id,
                          quantity: "1",
                          sellingPrice: "0",
                        },
                      ])
                    }
                  >
                    Add stock part
                  </button>
                </>
              )}
              {modal.kind === "jobApproval" && (
                <>
                  <div className="ops-note">
                    Record approval actually received from the customer for
                    revision {modal.row?.quotes[0]?.version}. This does not send
                    a message to the customer.
                  </div>
                  {field(
                    "Approving customer",
                    "customerName",
                    modal.row?.customerName,
                  )}
                  <label>
                    Approval method
                    <select name="method">
                      {["SIGNED", "EMAIL", "PHONE", "IN_PERSON"].map((s) => (
                        <option key={s} value={s}>
                          {s.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Evidence / reference
                    <textarea
                      name="evidence"
                      required
                      maxLength={1000}
                      placeholder="Signed quote reference, email date, or customer confirmation details"
                    />
                  </label>
                </>
              )}
              {modal.kind === "jobStatus" && (
                <>
                  <label>
                    Next status
                    <select name="status">
                      {(jobTransitions[modal.row?.status] ?? [])
                        .filter(
                          (s) =>
                            !tech ||
                            [
                              "INSPECTION",
                              "IN_PROGRESS",
                              "AWAITING_PARTS",
                              "COMPLETED",
                            ].includes(s),
                        )
                        .filter(
                          (s) =>
                            data.user.role !== "CASHIER" ||
                            ["AWAITING_APPROVAL", "DELIVERED"].includes(s),
                        )
                        .map((s) => (
                          <option key={s} value={s}>
                            {s.replaceAll("_", " ")}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Progress note
                    <textarea name="note" required maxLength={1000} />
                  </label>
                  <p>
                    Completion deducts approved materials once. Stop all timers
                    first. Delivery requires an invoice.
                  </p>
                </>
              )}
              {modal.kind === "jobTimeStop" && (
                <label>
                  Reason for stopping this timer
                  <textarea name="note" required maxLength={1000} />
                </label>
              )}
              {modal.kind === "inventoryItem" && (
                <>
                  {field("Item name", "name", modal.row?.name)}
                  {field("SKU", "sku", modal.row?.sku)}
                  <label>
                    Category
                    <input
                      name="category"
                      list="inventory-categories"
                      defaultValue={modal.row?.category ?? "Other consumables"}
                      required
                    />
                    <datalist id="inventory-categories">
                      {[
                        "Shampoo",
                        "Cleaning chemicals",
                        "Cleaning materials",
                        "Engine oil",
                        "Oil filters",
                        "Spare parts",
                        "Batteries",
                        "Other consumables",
                      ].map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </label>
                  {field(
                    "Unit (litre, unit, kg...)",
                    "unit",
                    modal.row?.unit ?? "unit",
                  )}
                  {field(
                    "Supplier",
                    "supplier",
                    modal.row?.supplier ?? "",
                    "text",
                    false,
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={modal.row?.active ?? true}
                    />
                    Active
                  </label>
                </>
              )}
              {modal.kind === "stockMove" && (
                <>
                  {branchSelect()}
                  {itemSelect()}
                  <label>
                    Movement
                    <select name="kind">
                      <option value="RECEIPT">Receipt / opening stock</option>
                      <option value="ADJUST_IN">Adjustment increase</option>
                      <option value="ADJUST_OUT">Adjustment decrease</option>
                    </select>
                  </label>
                  {field("Quantity", "quantity", "1", "number", true, "0.0001")}
                  {field(
                    "Received unit cost (AED; ignored for decrease)",
                    "unitCost",
                    "0",
                    "number",
                    true,
                    "0.01",
                  )}
                  <label>
                    Supplier reference / adjustment reason
                    <textarea name="note" required maxLength={1000} />
                  </label>
                  <p>
                    Decreases use the existing weighted cost. This movement
                    creates no expense or cash payment.
                  </p>
                </>
              )}
              {modal.kind === "stockTransfer" && (
                <>
                  {branchSelect("fromBranchId")}
                  <label>
                    Destination branch
                    <select name="toBranchId">
                      {data.branches
                        .filter((b: Row) => b.active && b.id !== formBranch)
                        .map((b: Row) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {itemSelect()}
                  {field("Quantity", "quantity", "1", "number", true, "0.0001")}
                  <label>
                    Transfer reference / note
                    <textarea name="note" required maxLength={1000} />
                  </label>
                  <p>
                    You must have access to both branches. The transfer
                    preserves source unit cost.
                  </p>
                </>
              )}
              {modal.kind === "stockSettings" && (
                <>
                  {branchSelect()}
                  {itemSelect()}
                  {field(
                    "Reorder level",
                    "reorderLevel",
                    "0",
                    "number",
                    true,
                    "0.0001",
                  )}
                  {field(
                    "Branch storage location",
                    "location",
                    "",
                    "text",
                    false,
                  )}
                </>
              )}
              {modal.kind === "serviceMaterials" && (
                <>
                  {branchSelect()}
                  <label>
                    Service
                    <select
                      value={recipeService}
                      required
                      onChange={(e) => {
                        setRecipeService(e.target.value);
                        setMaterialRows(
                          ops.recipes.find(
                            (r: Row) =>
                              r.branchId === formBranch &&
                              r.serviceId === e.target.value,
                          )?.materials ?? [],
                        );
                      }}
                    >
                      <option value="">Select a branch service</option>
                      {ops.recipes
                        .filter((r: Row) => r.branchId === formBranch)
                        .map((r: Row) => (
                          <option key={r.id} value={r.serviceId}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="ops-note">
                    Select each existing estimate that this material replaces.
                    Leave components such as payroll unchanged. Stock is
                    consumed when checkout completes or the approved job is
                    marked completed.
                  </div>
                  {materialRows.map((m, i) => (
                    <div className="recipe-row" key={i}>
                      <label>
                        Stock item
                        <select
                          value={m.itemId}
                          onChange={(e) =>
                            setMaterialRows(
                              materialRows.map((r, j) =>
                                j === i ? { ...r, itemId: e.target.value } : r,
                              ),
                            )
                          }
                        >
                          {ops.items
                            .filter((r: Row) => r.active)
                            .map((r: Row) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.unit})
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Quantity per service
                        <input
                          required
                          min="0.0001"
                          step="0.0001"
                          type="number"
                          value={m.quantity}
                          onChange={(e) =>
                            setMaterialRows(
                              materialRows.map((r, j) =>
                                j === i
                                  ? { ...r, quantity: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <fieldset>
                        <legend>Replaces estimated costs</legend>
                        {recipe?.costs
                          .filter((c: Row) => c.source !== "PAYROLL")
                          .map((c: Row, index: number) => (
                            <label className="check" key={index}>
                              <input
                                type="checkbox"
                                checked={m.replaceCostNames.includes(c.name)}
                                onChange={(e) =>
                                  setMaterialRows(
                                    materialRows.map((r, j) =>
                                      j === i
                                        ? {
                                            ...r,
                                            replaceCostNames: e.target.checked
                                              ? [...r.replaceCostNames, c.name]
                                              : r.replaceCostNames.filter(
                                                  (n: string) => n !== c.name,
                                                ),
                                          }
                                        : r,
                                    ),
                                  )
                                }
                              />
                              {c.name} · {c.amount}
                            </label>
                          ))}
                      </fieldset>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          setMaterialRows(
                            materialRows.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Remove material
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      !recipeService || !ops.items.some((i: Row) => i.active)
                    }
                    onClick={() =>
                      setMaterialRows([
                        ...materialRows,
                        {
                          itemId: ops.items.find((i: Row) => i.active)?.id,
                          quantity: "1",
                          replaceCostNames: [],
                        },
                      ])
                    }
                  >
                    Add material
                  </button>
                </>
              )}
              {modal.kind === "productivityTarget" && (
                <>
                  {field(
                    "Monthly associated service target (0 = unset)",
                    "target",
                    String(modal.row?.target ?? 0),
                    "number",
                    true,
                    "1",
                  )}
                  <p>
                    Targets compare associated services; team counts overlap and
                    are not company totals.
                  </p>
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
