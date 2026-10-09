"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ReceiptText,
  Layers,
  Users,
  Building2,
  Wallet,
  Settings,
  ShieldCheck,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Menu,
  X,
  Search,
  CircleHelp,
  TrendingUp,
  Calculator,
  Landmark,
  FileBarChart,
  Package,
  ClipboardList,
  Clock,
} from "lucide-react";
import {
  D,
  money,
  serviceCost,
  expenseInMonth,
  dubaiDate,
  period,
  Cost,
} from "@/lib/finance";
import MarketingWorkspace from "./marketing-workspace";
import VoucherCheckout from "./voucher-checkout";
import CustomerWorkspace from "./customer-workspace";
import CustomerPicker from "./customer-picker";
import OperationsWorkspace from "./operations-workspace";
import FinancialWorkspace from "./financial-workspace";
import {
  expenseMonth,
  resolveExpense,
  buildReport,
  monthStart,
} from "@/lib/intelligence";
type Row = Record<string, any>;
export default function Workspace({ data }: { data: Row }) {
  const router = useRouter(),
    finance = ["OWNER", "MANAGER"].includes(data.user.role),
    owner = data.user.role === "OWNER";
  const [tab, setTab] = useState(
      data.user.role === "CASHIER"
        ? "Sales"
        : data.user.role === "TECHNICIAN"
          ? "My jobs"
          : "Overview",
    ),
    [branch, setBranch] = useState("all"),
    [date, setDate] = useState(dubaiDate()),
    [search, setSearch] = useState(""),
    [serviceFilter, setServiceFilter] = useState("all"),
    [employeeFilter, setEmployeeFilter] = useState("all"),
    [paymentFilter, setPaymentFilter] = useState("all"),
    [modal, setModal] = useState<{ kind: string; row?: Row } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState("");
  useEffect(() => {
    let lastToday = dubaiDate();
    const t = setInterval(() => {
      const nextToday = dubaiDate();
      if (nextToday !== lastToday) {
        const previousToday = lastToday;
        setDate((selected) =>
          selected === previousToday ? nextToday : selected,
        );
        lastToday = nextToday;
      }
      router.refresh();
    }, 30000);
    return () => clearInterval(t);
  }, [router]);
  const branches = data.branches as Row[],
    services = data.services as Row[],
    staff = data.staff as Row[];
  const scoped = (rows: Row[]) =>
    rows.filter((r) => branch === "all" || r.branchId === branch);
  const filterSale = (s: Row) =>
    (serviceFilter === "all" ||
      s.lines.some((l: Row) => l.serviceId === serviceFilter)) &&
    (employeeFilter === "all" ||
      s.workers.some((w: Row) => w.userId === employeeFilter)) &&
    (paymentFilter === "all" ||
      s.payments?.some((p: Row) => p.method === paymentFilter));
  const sales =
    data.user.role === "TECHNICIAN"
      ? []
      : scoped(data.sales).filter(
          (s) => s.status === "COMPLETED" && filterSale(s),
        );
  const month = sales.filter(
    (s) =>
      dubaiDate(new Date(s.createdAt)).slice(0, 7) === date.slice(0, 7) &&
      dubaiDate(new Date(s.createdAt)) <= date,
  );
  const today = month.filter((s) => dubaiDate(new Date(s.createdAt)) === date);
  const sum = (rows: Row[], key: string) =>
    rows.reduce<ReturnType<typeof D>>((s, r) => s.plus(r[key]), D(0));
  const asOf = date > dubaiDate() ? dubaiDate() : date;
  const reportOptions = {
    branchIds: branches
      .filter((b) => branch === "all" || b.id === branch)
      .map((b) => b.id),
    start: monthStart(asOf),
    end: asOf,
    ...(serviceFilter !== "all" ? { serviceId: serviceFilter } : {}),
    ...(employeeFilter !== "all" ? { employeeId: employeeFilter } : {}),
    ...(paymentFilter !== "all" ? { method: paymentFilter } : {}),
  };
  const financialReport =
    finance && data.intelligence
      ? buildReport(data.intelligence, reportOptions)
      : null;
  const dailyReport =
    finance && data.intelligence
      ? buildReport(data.intelligence, { ...reportOptions, start: asOf })
      : null;
  const expenseRecords: Row[] =
    finance && data.intelligence ? data.intelligence.expenses : data.expenses;
  const displayExpenses = expenseRecords.map((e) => ({
    ...e,
    ...resolveExpense(e as any, asOf.slice(0, 7)),
    id: e.id,
  }));
  const revenue = financialReport
      ? D(financialReport.summary.revenue)
      : sum(month, "net"),
    cost = financialReport
      ? D(financialReport.summary.serviceCosts)
      : sum(month, "cost"),
    operating = financialReport
      ? D(financialReport.summary.operatingExpenses)
      : scoped(displayExpenses).reduce<ReturnType<typeof D>>(
          (s, e) =>
            s.plus(
              expenseInMonth(
                {
                  amount: e.amount,
                  frequency: e.frequency,
                  active: e.active,
                  date: new Date(e.date),
                },
                date,
              ),
            ),
          D(0),
        ),
    profit = revenue.minus(cost).minus(operating);
  const balance = (s: Row) => D(s.total).minus(sum(s.payments, "amount"));
  const nav = finance
    ? [
        "Overview",
        "Forecast",
        "Break-even",
        "Investment & ROI",
        "Reports",
        "Customers",
        "Marketing",
        "Job cards",
        "Inventory",
        "Productivity",
        "Attendance",
        "Sales",
        "Services",
        "Employees",
        "Branches",
        "Expenses",
        ...(owner ? ["Settings"] : []),
        "Audit log",
      ]
    : data.user.role === "CASHIER"
      ? [
          "Sales",
          "Customers",
          "Marketing",
          "Job cards",
          "Attendance",
          "Services",
        ]
      : ["My jobs", "Attendance"];
  const icons: Row = {
    Overview: LayoutDashboard,
    Forecast: TrendingUp,
    "Break-even": Calculator,
    "Investment & ROI": Landmark,
    Reports: FileBarChart,
    Sales: ReceiptText,
    Services: Layers,
    Employees: Users,
    Branches: Building2,
    Expenses: Wallet,
    Settings: Settings,
    "Audit log": ShieldCheck,
    "My jobs": ClipboardList,
    Customers: Users,
    Marketing: TrendingUp,
    "Job cards": ClipboardList,
    Inventory: Package,
    Productivity: Users,
    Attendance: Clock,
  };
  const open = (kind: string, row?: Row) => {
    setError("");
    setModal({ kind, row });
  };
  async function mutate(action: string, values: Row) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: values }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setModal(null);
      setToast("Saved successfully");
      router.refresh();
      if (action === "sale") window.open(`/receipt/${result.id}`, "_blank");
      setTimeout(() => setToast(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      v: Row = Object.fromEntries(f.entries()),
      kind = modal!.kind;
    v.active = f.get("active") === "on";
    if (modal?.row?.id) v.id = modal.row.id;
    if (kind === "user") v.branchIds = f.getAll("branchIds");
    if (kind === "service") {
      v.duration = Number(v.duration);
      v.labor = Number(v.labor);
      try {
        v.prices = branches.map((b) => ({
          branchId: b.id,
          price: String(f.get(`price_${b.id}`)),
          active: f.get(`enabled_${b.id}`) === "on",
          costs: JSON.parse(String(f.get(`costs_${b.id}`))),
        }));
      } catch {
        setError("Cost components must be valid JSON. Use the example below.");
        return;
      }
    }
    if (kind === "sale") {
      v.serviceIds = f.getAll("serviceIds");
      v.workerIds = f.getAll("workerIds");
      v.requestKey = String(f.get("requestKey"));
    }
    if (!v.customerId) delete v.customerId;
    if (!v.vehicleId) delete v.vehicleId;
    mutate(kind, v);
  }
  const table = (heads: string[], rows: React.ReactNode[][]) => (
    <div className="table-wrap">
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
                No records for this selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.code ?? "—";
  const edit = (kind: string, row: Row) => (
    <button className="link" onClick={() => open(kind, row)}>
      Edit <ChevronRight size={13} />
    </button>
  );
  const stat = (label: string, value: string, note: string, color = "") => (
    <div className={`stat ${color}`}>
      <span>
        {label}
        <ArrowUpRight size={16} />
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
  const visibleSales = scoped(data.sales)
    .filter(
      (s: Row) =>
        filterSale(s) &&
        dubaiDate(new Date(s.createdAt)).slice(0, 7) === date.slice(0, 7) &&
        dubaiDate(new Date(s.createdAt)) <= date,
    )
    .filter((s: Row) =>
      [s.number, s.plate, s.customerName]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <div className="shell">
      <aside className={mobile ? "sidebar show" : "sidebar"}>
        <div className="brand">
          <span className="brandmark">P</span>
          <div>
            PROTUNE<small>AUTO SERVICES</small>
          </div>
        </div>
        <div className="workspace-label">BUSINESS WORKSPACE</div>
        <nav>
          {nav.map((n) => {
            const Icon = icons[n];
            return (
              <button
                key={n}
                className={tab === n ? "selected" : ""}
                onClick={() => {
                  setTab(n);
                  setMobile(false);
                }}
              >
                <Icon size={19} />
                {n}
                {n === tab && <span className="nav-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help">
            <CircleHelp size={18} />
            <div>
              Built for your business<small>Phase 6 · Operations</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">
              {data.user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              {data.user.name}
              <small>{data.user.role.toLowerCase()}</small>
            </div>
          </div>
          <form action="/api/logout" method="post">
            <button className="logout">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main">
        <header>
          <button
            className="mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span>
            Workspace <ChevronRight size={14} /> <b>{tab}</b>
          </span>
          <div className="header-right">
            <span className="live-dot" />
            Refreshes every 30s <span className="timezone">Dubai · UTC+4</span>
          </div>
        </header>
        <div className="content">
          <div className="sample-banner">
            <span>
              {data.settings.sampleMode
                ? "✦ SAMPLE WORKSPACE"
                : "✦ OPERATIONS WORKSPACE"}
            </span>{" "}
            {data.settings.sampleMode
              ? "Seeded figures are fictional. New transactions are real local records."
              : "Phase 6 workspace"}{" "}
            <span className="phase">Phase 6</span>
          </div>
          <div className="page-title">
            <div>
              <div className="eyebrow">PROTUNE AUTO SERVICES</div>
              <h1>{tab === "Overview" ? "Business overview" : tab}</h1>
              <p>
                {tab === "Overview"
                  ? "A clear picture of your branches, every day."
                  : tab === "Sales"
                    ? "Record services, collect payments, and track customer balances."
                    : tab === "Services"
                      ? "Your services, prices, and cost components — all in one place."
                      : tab === "Expenses"
                        ? "Keep operating expenses separate from direct service costs."
                        : "Manage your business with clear, branch-specific records."}
              </p>
            </div>
            {tab === "Sales" && (
              <button onClick={() => open("sale")}>
                <Plus size={17} /> New transaction
              </button>
            )}
            {owner && ["Services", "Employees", "Branches"].includes(tab) && (
              <button
                onClick={() =>
                  open(
                    (
                      {
                        Services: "service",
                        Employees: "user",
                        Branches: "branch",
                      } as Row
                    )[tab],
                  )
                }
              >
                <Plus size={17} /> Add{" "}
                {tab === "Employees"
                  ? "employee"
                  : tab.toLowerCase().slice(0, -1)}
              </button>
            )}
            {tab === "Expenses" && (
              <button onClick={() => open("expense")}>
                <Plus size={17} /> Record expense
              </button>
            )}
          </div>
          <div className="filters">
            <label>
              <Building2 size={16} />
              <select
                aria-label="Filter branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="all">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="date"
                aria-label="Reporting date"
                max={dubaiDate()}
                value={date}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </label>
            {["Overview", "Sales"].includes(tab) && (
              <>
                <label>
                  <select
                    aria-label="Filter service"
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                  >
                    <option value="all">All services</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <select
                    aria-label="Filter employee"
                    value={employeeFilter}
                    onChange={(e) => setEmployeeFilter(e.target.value)}
                  >
                    <option value="all">All employees</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <select
                    aria-label="Filter payment"
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                  >
                    <option value="all">All payments</option>
                    {["CASH", "CARD", "TRANSFER", "OTHER"].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <span>AED · Prices exclude VAT</span>
          </div>
          {finance &&
            ["Forecast", "Break-even", "Investment & ROI", "Reports"].includes(
              tab,
            ) &&
            data.intelligence && (
              <FinancialWorkspace
                tab={tab}
                data={data.intelligence}
                branch={branch}
                date={date}
                owner={owner}
                staff={staff.map((s) => ({ id: s.id, name: s.name }))}
              />
            )}
          {[
            "Job cards",
            "My jobs",
            "Inventory",
            "Productivity",
            "Attendance",
          ].includes(tab) &&
            data.operations && (
              <OperationsWorkspace
                tab={tab}
                data={data}
                branch={branch}
                date={asOf}
              />
            )}
          {tab === "Marketing" && data.marketing && (
            <MarketingWorkspace data={data} branch={branch} />
          )}
          {tab === "Customers" && data.crm && (
            <CustomerWorkspace data={data} branch={branch} date={asOf} />
          )}
          {toast && <div className="success">{toast}</div>}
          {tab === "Overview" && (
            <>
              <div className="section-label">
                MONTH TO DATE <span>{date.slice(0, 7)}</span>
              </div>
              <div className="stats">
                {stat(
                  "Net revenue",
                  money(revenue),
                  "Recorded sales · VAT excluded",
                )}
                {stat(
                  "Service costs",
                  money(cost),
                  "Historical estimated variable costs",
                )}
                {stat(
                  "Operating expenses",
                  money(operating),
                  "Recurring expenses recognized through selected date",
                )}
                {stat(
                  "Estimated operating profit",
                  financialReport?.filtered ? "Unavailable" : money(profit),
                  financialReport?.filtered
                    ? "Branch overhead is unallocated"
                    : "Net revenue − service costs − expenses",
                  financialReport?.filtered
                    ? ""
                    : profit.gte(0)
                      ? "green"
                      : "red",
                )}
              </div>
              {financialReport && (
                <div className="overview-details">
                  <span>
                    Net profit · estimated{" "}
                    <b>
                      {financialReport.summary.netProfit === null
                        ? "Unavailable"
                        : money(financialReport.summary.netProfit)}
                    </b>
                  </span>
                  <span>
                    Net margin{" "}
                    <b>
                      {financialReport.summary.margin === null
                        ? "Unavailable"
                        : `${financialReport.summary.margin}%`}
                    </b>
                  </span>
                  <span>
                    Completed service lines{" "}
                    <b>{financialReport.summary.services}</b>
                  </span>
                  <span>
                    Outstanding invoices{" "}
                    <b>{money(financialReport.summary.outstanding)}</b>
                  </span>
                </div>
              )}
              <div className="dashboard-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Revenue activity</h2>
                      <p>Daily net sales this month</p>
                    </div>
                    <span className="badge">
                      {branch === "all" ? "All branches" : branchName(branch)}
                    </span>
                  </div>
                  <div className="chart">
                    <div className="chart-grid">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} />
                      ))}
                    </div>
                    {Array.from({ length: period(date).days }, (_, i) => {
                      const day = i + 1,
                        rs = month.filter(
                          (s) =>
                            Number(
                              dubaiDate(new Date(s.createdAt)).slice(-2),
                            ) === day,
                        ),
                        total = financialReport
                          ? D(
                              financialReport.dailyRows.find(
                                (r) => Number(r.date.slice(-2)) === day,
                              )?.revenue ?? 0,
                            ).toNumber()
                          : sum(rs, "net").toNumber(),
                        max = financialReport
                          ? Math.max(
                              1,
                              ...financialReport.dailyRows.map((r) =>
                                D(r.revenue).toNumber(),
                              ),
                            )
                          : Math.max(
                              1,
                              ...Array.from(
                                { length: period(date).days },
                                (_, j) =>
                                  sum(
                                    month.filter(
                                      (s) =>
                                        Number(
                                          dubaiDate(
                                            new Date(s.createdAt),
                                          ).slice(-2),
                                        ) ===
                                        j + 1,
                                    ),
                                    "net",
                                  ).toNumber(),
                              ),
                            );
                      return (
                        <div className="chart-column" key={i}>
                          <div
                            title={`${day}: ${money(total)}`}
                            style={{
                              height: `${Math.max(total ? 2 : 0, (total / max) * 100)}%`,
                            }}
                          />
                          <span>{day === 1 || day % 5 === 0 ? day : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="chart-caption">
                    <span className="legend-dot" />
                    Net revenue <small>Hover over a bar to see its value</small>
                  </div>
                </section>
                <section className="panel today-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Today at a glance</h2>
                      <p>{date} · Dubai time</p>
                    </div>
                    <span className="live-dot" />
                  </div>
                  {[
                    [
                      "Revenue",
                      dailyReport
                        ? money(dailyReport.summary.revenue)
                        : money(sum(today, "net")),
                    ],
                    [
                      "Vehicles serviced",
                      String(dailyReport?.summary.vehicles ?? today.length),
                    ],
                    [
                      "Average transaction",
                      money(
                        dailyReport
                          ? dailyReport.summary.vehicles
                            ? D(dailyReport.summary.revenue).div(
                                dailyReport.summary.vehicles,
                              )
                            : 0
                          : today.length
                            ? sum(today, "net").div(today.length)
                            : 0,
                      ),
                    ],
                    [
                      "Variable costs",
                      dailyReport
                        ? money(dailyReport.summary.serviceCosts)
                        : money(sum(today, "cost")),
                    ],
                    [
                      "Estimated operating profit",
                      dailyReport
                        ? dailyReport.summary.operatingProfit === null
                          ? "Unavailable"
                          : money(dailyReport.summary.operatingProfit)
                        : money(
                            sum(today, "net")
                              .minus(sum(today, "cost"))
                              .minus(operating.div(period(date).days)),
                          ),
                    ],
                  ].map(([k, v]) => (
                    <div className="metric-row" key={k}>
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                  <p className="note">
                    Recurring expenses are recognized by calendar-day
                    allocation; one-time expenses use their recorded date.
                    Service costs are estimates; net profit and cash flow are
                    separate measures.
                  </p>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Branch performance</h2>
                    <p>Compare revenue and estimated operating contribution</p>
                  </div>
                  <Building2 size={20} />
                </div>
                <div className="branch-cards">
                  {branches
                    .filter((b) => branch === "all" || b.id === branch)
                    .map((b) => {
                      const bs = month.filter((s) => s.branchId === b.id),
                        branchReport = data.intelligence
                          ? buildReport(data.intelligence, {
                              ...reportOptions,
                              branchIds: [b.id],
                            })
                          : null;
                      const br = branchReport
                          ? D(branchReport.summary.revenue)
                          : sum(bs, "net"),
                        bc = branchReport
                          ? D(branchReport.summary.serviceCosts)
                          : sum(bs, "cost"),
                        be = branchReport
                          ? D(branchReport.summary.operatingExpenses)
                          : D(0),
                        bp = br.minus(bc).minus(be);
                      return (
                        <div className="branch-card" key={b.id}>
                          <div>
                            <span className="branch-icon">
                              <Building2 size={20} />
                            </span>
                            <h3>
                              {b.name}
                              <small>
                                {b.code} ·{" "}
                                {b.active ? "Active branch" : "Inactive"}
                              </small>
                            </h3>
                            <span
                              className={
                                branchReport?.filtered
                                  ? "badge"
                                  : bp.gte(0)
                                    ? "badge positive"
                                    : "badge negative"
                              }
                            >
                              {branchReport?.filtered
                                ? "Contribution view"
                                : bp.gte(0)
                                  ? "Profitable"
                                  : "Below break-even"}
                            </span>
                          </div>
                          <dl>
                            <div>
                              <dt>Revenue</dt>
                              <dd>{money(br)}</dd>
                            </div>
                            <div>
                              <dt>Operating profit · est.</dt>
                              <dd
                                className={
                                  bp.gte(0) ? "positive-text" : "negative-text"
                                }
                              >
                                {branchReport?.filtered
                                  ? "Unavailable"
                                  : money(bp)}
                              </dd>
                            </div>
                            <div>
                              <dt>Vehicles</dt>
                              <dd>{bs.length}</dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent transactions</h2>
                    <p>Latest activity across your selected branches</p>
                  </div>
                  <button className="link" onClick={() => setTab("Sales")}>
                    View all <ArrowUpRight size={15} />
                  </button>
                </div>
                {table(
                  [
                    "Transaction / vehicle",
                    "Branch",
                    "Service",
                    "Net revenue",
                    "Payment",
                    "Receipt",
                  ],
                  sales.slice(0, 5).map((s) => [
                    <div key={s.id}>
                      <b>{s.plate}</b>
                      <small>
                        {s.number}
                        {s.sample ? " · SAMPLE" : ""}
                      </small>
                    </div>,
                    branchName(s.branchId),
                    s.lines.map((l: Row) => l.name).join(", "),
                    money(s.net),
                    <span
                      key="p"
                      className={
                        balance(s).gt(0) ? "badge warning" : "badge positive"
                      }
                    >
                      {balance(s).gt(0) ? "Partial / unpaid" : "Paid"}
                    </span>,
                    <a
                      key="r"
                      className="link"
                      href={`/receipt/${s.id}`}
                      target="_blank"
                    >
                      View →
                    </a>,
                  ]),
                )}
              </section>
            </>
          )}
          {tab === "Sales" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Transaction ledger</h2>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Search plate, number, customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              {table(
                [
                  "Transaction",
                  "Date",
                  "Branch",
                  "Services",
                  "Total incl. VAT",
                  "Balance",
                  "Status",
                  "Actions",
                ],
                visibleSales.map((s) => [
                  <div key="n">
                    <b>{s.plate}</b>
                    <small>
                      {s.number}
                      {s.sample ? " · SAMPLE" : ""}
                    </small>
                  </div>,
                  dubaiDate(new Date(s.createdAt)),
                  branchName(s.branchId),
                  s.lines.map((l: Row) => l.name).join(", "),
                  money(s.total),
                  money(balance(s)),
                  s.status,
                  <div className="actions" key="a">
                    <a
                      className="link"
                      href={`/receipt/${s.id}`}
                      target="_blank"
                    >
                      Receipt
                    </a>
                    {s.status === "COMPLETED" && balance(s).gt(0) && (
                      <button
                        className="link"
                        onClick={() => open("payment", s)}
                      >
                        Collect
                      </button>
                    )}
                    {finance &&
                      s.status === "COMPLETED" &&
                      s.payments.length === 0 && (
                        <button
                          className="link"
                          onClick={() => open("cancel", s)}
                        >
                          Cancel
                        </button>
                      )}
                  </div>,
                ]),
              )}
            </section>
          )}
          {tab === "Services" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Service catalog</h2>
                {owner && (
                  <button
                    className="secondary"
                    onClick={() => open("category")}
                  >
                    Add category
                  </button>
                )}
              </div>
              {table(
                [
                  "Service",
                  "Category",
                  "Duration / team",
                  "Branch",
                  "Price excl. VAT",
                  ...(finance ? ["Est. cost / margin"] : []),
                  "Status",
                  ...(owner ? [""] : []),
                ],
                services.flatMap((s) =>
                  s.branches
                    .filter(
                      (b: Row) => branch === "all" || b.branchId === branch,
                    )
                    .map((b: Row) => [
                      <div key="name">
                        <b>{s.name}</b>
                        <small>{s.materials}</small>
                      </div>,
                      s.category.name,
                      `${s.duration} min · ${s.labor} person(s)`,
                      branchName(b.branchId),
                      money(b.price),
                      ...(finance
                        ? [
                            `${money(serviceCost(b.price, b.estimatedCost ?? b.costs))} / ${
                              D(b.price).gt(0)
                                ? D(b.price)
                                    .minus(
                                      serviceCost(
                                        b.price,
                                        b.estimatedCost ?? b.costs,
                                      ),
                                    )
                                    .div(b.price)
                                    .mul(100)
                                    .toFixed(1)
                                : "0"
                            }%`,
                          ]
                        : []),
                      <span key="status" className="badge">
                        {s.active && s.category.active && b.active
                          ? "Active"
                          : "Inactive"}
                      </span>,
                      ...(owner ? [edit("service", s)] : []),
                    ]),
                ),
              )}
              {owner && (
                <div className="category-list">
                  {data.categories.map((c: Row) => (
                    <button
                      key={c.id}
                      className="secondary"
                      onClick={() => open("category", c)}
                    >
                      {c.name} · {c.active ? "active" : "inactive"} ✎
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {tab === "Employees" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Team directory</h2>
                  <p>
                    Salaries are reference values; record payroll as an expense
                    to include it in profit.
                  </p>
                </div>
              </div>
              {table(
                [
                  "Employee",
                  "Role",
                  "Branches",
                  "Salary / month",
                  "Schedule",
                  "Status",
                  ...(owner ? [""] : []),
                ],
                staff
                  .filter(
                    (s) =>
                      branch === "all" ||
                      s.branches.some((b: Row) => b.branchId === branch),
                  )
                  .map((s) => [
                    <div key="n">
                      <b>{s.name}</b>
                      <small>
                        {s.title} · {s.email}
                      </small>
                    </div>,
                    s.role,
                    s.branches
                      .map((b: Row) => branchName(b.branchId))
                      .join(", "),
                    money(s.salary),
                    s.schedule,
                    s.active ? "Active" : "Inactive",
                    ...(owner ? [edit("user", s)] : []),
                  ]),
              )}
            </section>
          )}
          {tab === "Branches" && (
            <section className="panel">
              {table(
                ["Branch", "Code", "Status", ...(owner ? [""] : [])],
                branches.map((b) => [
                  b.name,
                  b.code,
                  b.active ? "Active" : "Inactive",
                  ...(owner ? [edit("branch", b)] : []),
                ]),
              )}
            </section>
          )}
          {tab === "Expenses" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Operating expenses</h2>
                  <p>
                    Recurring costs continue from their start month. Annual
                    amounts are allocated over 12 months.
                  </p>
                </div>
                {owner && (
                  <button
                    className="secondary"
                    onClick={() => open("expenseCategory")}
                  >
                    Add category
                  </button>
                )}
              </div>
              {table(
                [
                  "Category / description",
                  "Branch",
                  "Amount",
                  "Starts / date",
                  "Frequency",
                  "Type",
                  "This month",
                  "",
                ],
                scoped(displayExpenses).map((e) => [
                  <div key="n">
                    <b>{e.category}</b>
                    <small>
                      {e.description}
                      {e.sample ? " · SAMPLE" : ""}
                    </small>
                  </div>,
                  branchName(e.branchId),
                  money(e.amount),
                  dubaiDate(new Date(e.date)),
                  e.frequency,
                  e.kind,
                  money(
                    expenseInMonth(
                      { ...e, date: new Date(e.date) } as any,
                      date,
                    ),
                  ),
                  edit("expense", e),
                ]),
              )}
              <p className="note pad">
                Record only costs not already included in service estimates. For
                shared water, electricity, or consumables, enter the unallocated
                balance here. Payroll-tagged service costs are excluded
                automatically.
              </p>
            </section>
          )}
          {tab === "Audit log" && (
            <section className="panel">
              {table(
                ["Time (Dubai)", "User", "Action", "Branch", "Record"],
                data.audits.map((a: Row) => [
                  new Date(a.createdAt).toLocaleString("en-AE", {
                    timeZone: "Asia/Dubai",
                  }),
                  a.user.name,
                  a.action,
                  branchName(a.branchId),
                  a.entityId,
                ]),
              )}
            </section>
          )}
          {tab === "Settings" && (
            <section className="panel settings">
              <h2>Company settings</h2>
              <p>
                VAT changes apply to new sales only. Review tax and production
                settings before real operations.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  mutate(
                    "settings",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                }}
              >
                <label>
                  Company name
                  <input
                    name="companyName"
                    defaultValue={data.settings.companyName}
                    required
                  />
                </label>
                <label>
                  VAT rate (%)
                  <input
                    name="vatRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={data.settings.vatRate}
                    required
                  />
                </label>
                <label>
                  Tax registration number
                  <input name="trn" defaultValue={data.settings.trn} />
                </label>
                <p className="error">{error}</p>
                <button disabled={busy}>Save settings</button>
              </form>
              <div className="note">
                Currency: AED · Timezone: Asia/Dubai · English
                <br />
                Marketing integrations are scheduled for later phases.
              </div>
            </section>
          )}
          <footer>
            PROTUNE AUTO SERVICES{" "}
            <span>
              Phase 6 · Financial estimates use recorded transactions and
              expense commitments
            </span>
          </footer>
        </div>
      </main>
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Manage record"
          >
            <div className="panel-heading">
              <h2>
                {modal.row ? "Edit / manage" : "Create"} {modal.kind}
              </h2>
              <button
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            <form onSubmit={submit}>
              <ModalFields
                kind={modal.kind}
                row={modal.row}
                data={data}
                selectedBranch={branch}
              />
              <p className="error" role="alert">
                {error}
              </p>
              <div className="form-actions">
                {owner &&
                  modal.row &&
                  ["service", "category"].includes(modal.kind) && (
                    <button
                      type="button"
                      className="remove-button"
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          modal.kind === "service"
                            ? "removeService"
                            : "removeCategory",
                          { id: modal.row!.id },
                        )
                      }
                    >
                      Remove unused {modal.kind}
                    </button>
                  )}
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setModal(null)}
                >
                  Close
                </button>
                <button disabled={busy}>
                  {busy ? "Saving…" : "Save " + modal.kind}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function ModalFields({
  kind,
  row: r = {},
  data,
  selectedBranch,
}: {
  kind: string;
  row?: Row;
  data: Row;
  selectedBranch: string;
}) {
  const [saleBranch, setSaleBranch] = useState(
      selectedBranch === "all"
        ? data.branches.find((b: Row) => b.active)?.id
        : selectedBranch,
    ),
    [selected, setSelected] = useState<string[]>([]),
    [discount, setDiscount] = useState("0"),
    [voucherDiscount, setVoucherDiscount] = useState("0"),
    [linkedCustomer, setLinkedCustomer] = useState<Row | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const input = (
    name: string,
    label: string,
    type = "text",
    value?: string,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? r[name] ?? ""}
        required={name !== "password" || !r.id}
        {...(type === "number" ? { min: 0, step: "0.01" } : {})}
      />
    </label>
  );
  const select = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    value?: string,
  ) => (
    <label>
      {label}
      <select name={name} defaultValue={value ?? r[name] ?? options[0]?.value}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const branchInput = select(
    "branchId",
    "Branch",
    data.branches
      .filter((b: Row) => b.active)
      .map((b: Row) => ({ value: b.id, label: b.name })),
    selectedBranch === "all" ? r.branchId : selectedBranch,
  );
  const active = (
    <label className="checkbox">
      <input type="checkbox" name="active" defaultChecked={r.active ?? true} />{" "}
      Active
    </label>
  );
  if (kind === "branch")
    return (
      <>
        {input("name", "Branch name")}
        {input("code", "Branch code")}
        {active}
      </>
    );
  if (kind === "category" || kind === "expenseCategory")
    return (
      <>
        {input("name", "Category name")}
        {kind === "category" && active}
      </>
    );
  if (kind === "user")
    return (
      <>
        {input("name", "Full name")}
        {input("email", "Email", "email")}
        {input(
          "password",
          r.id
            ? "New password (leave blank to retain)"
            : "Unique password (12+ characters)",
          "password",
          "",
        )}
        {select(
          "role",
          "Access role",
          ["OWNER", "MANAGER", "CASHIER", "TECHNICIAN"].map((x) => ({
            value: x,
            label: x,
          })),
        )}
        {input("title", "Job title")}
        {input(
          "salary",
          "Monthly salary (AED)",
          "number",
          "" + (r.salary ?? 0),
        )}
        {input(
          "schedule",
          "Working schedule",
          "text",
          r.schedule ?? "48 hours/week",
        )}
        <fieldset>
          <legend>Branch assignments</legend>
          {data.branches.map((b: Row) => (
            <label className="checkbox" key={b.id}>
              <input
                type="checkbox"
                name="branchIds"
                value={b.id}
                defaultChecked={r.branches?.some(
                  (a: Row) => a.branchId === b.id,
                )}
              />
              {b.name}
            </label>
          ))}
        </fieldset>
        {active}
      </>
    );
  if (kind === "service")
    return (
      <>
        {input("name", "Service name")}
        {select(
          "categoryId",
          "Category",
          data.categories.map((c: Row) => ({ value: c.id, label: c.name })),
        )}
        {input(
          "duration",
          "Estimated duration (minutes)",
          "number",
          String(r.duration ?? 30),
        )}
        {input("labor", "Required team size", "number", String(r.labor ?? 1))}
        {input(
          "materials",
          "Material requirements",
          "text",
          r.materials ?? "None",
        )}
        {active}
        <p className="note">
          Costs support FIXED, PERCENT, or QUANTITY. PERCENT uses the
          pre-discount selling price. Use source PAYROLL for salaried labor; it
          is excluded to prevent counting payroll twice. DIRECT covers
          incremental costs only.
        </p>
        {data.branches.map((b: Row) => {
          const config = r.branches?.find((c: Row) => c.branchId === b.id);
          return (
            <fieldset key={b.id}>
              <legend>{b.name}</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  name={`enabled_${b.id}`}
                  defaultChecked={config?.active ?? true}
                />
                Available here
              </label>
              <CostEditor
                branchId={b.id}
                initialPrice={config?.price ?? "50"}
                initialCosts={
                  config?.costs ?? [
                    {
                      name: "Water",
                      mode: "FIXED",
                      amount: "2",
                      source: "DIRECT",
                    },
                    {
                      name: "Electricity",
                      mode: "FIXED",
                      amount: "1",
                      source: "DIRECT",
                    },
                    {
                      name: "Chemicals",
                      mode: "QUANTITY",
                      amount: "3",
                      quantity: "1",
                      source: "DIRECT",
                    },
                    {
                      name: "Materials",
                      mode: "FIXED",
                      amount: "2",
                      source: "DIRECT",
                    },
                    {
                      name: "Incremental labor",
                      mode: "FIXED",
                      amount: "7",
                      source: "DIRECT",
                    },
                  ]
                }
              />
            </fieldset>
          );
        })}
      </>
    );
  if (kind === "expense")
    return (
      <>
        {branchInput}
        {select(
          "category",
          "Category",
          data.expenseCategories.map((c: Row) => ({
            value: c.name,
            label: c.name,
          })),
        )}
        {input("description", "Description")}
        {input("amount", "Amount (AED)", "number")}
        {input(
          "date",
          "Expense date / recurrence starts",
          "date",
          r.date ? dubaiDate(new Date(r.date)) : dubaiDate(),
        )}
        {select("frequency", "Allocation", [
          { value: "ONCE", label: "One-time" },
          { value: "MONTHLY", label: "Recurring monthly" },
          { value: "ANNUAL", label: "Annual amount / 12 each month" },
        ])}
        {select("kind", "Expense type", [
          { value: "FIXED", label: "Fixed operating expense" },
          { value: "OTHER", label: "Other non-operating expense" },
          { value: "TAX", label: "Recorded tax expense (manual)" },
          {
            value: "VARIABLE",
            label: "Variable (not included in service costs)",
          },
        ])}
        <label>
          Revision effective from month
          <input
            name="effectiveMonth"
            type="month"
            defaultValue={
              r.id
                ? dubaiDate().slice(0, 7)
                : r.date
                  ? dubaiDate(new Date(r.date)).slice(0, 7)
                  : dubaiDate().slice(0, 7)
            }
            required
          />
        </label>
        {active}
        <p className="note">
          Earlier months retain their previous expense version. Closed periods
          cannot be revised. Do not record the same cost here and in the service
          cost calculator.
        </p>
      </>
    );
  if (kind === "sale") {
    const configs = data.services.flatMap((s: Row) =>
      s.active && s.category.active
        ? s.branches
            .filter((b: Row) => b.branchId === saleBranch && b.active)
            .map((b: Row) => ({ ...b, name: s.name }))
        : [],
    );
    let total = D(0);
    try {
      total = configs
        .filter((c: Row) => selected.includes(c.serviceId))
        .reduce((s: any, c: Row) => s.plus(c.price), D(0))
        .minus(discount || 0)
        .minus(voucherDiscount || 0)
        .mul(D(1).plus(D(data.settings.vatRate).div(100)));
    } catch {}
    return (
      <>
        <input type="hidden" name="requestKey" value={key} />
        <label>
          Branch
          <select
            name="branchId"
            value={saleBranch}
            onChange={(e) => {
              setSaleBranch(e.target.value);
              setSelected([]);
            }}
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
        <CustomerPicker
          crm={data.crm}
          branchId={saleBranch}
          onSelect={setLinkedCustomer}
        />
        <label>
          Vehicle plate
          <input
            name="plate"
            required
            key={linkedCustomer?.vehicle?.id ?? "manual-plate"}
            defaultValue={linkedCustomer?.vehicle?.plate ?? ""}
          />
        </label>
        <label>
          Customer / walk-in
          <input
            name="customerName"
            required
            key={linkedCustomer?.customer?.id ?? "walk-in"}
            defaultValue={linkedCustomer?.customer?.name ?? "Walk-in"}
          />
        </label>
        <fieldset>
          <legend>Services</legend>
          {configs.map((c: Row) => (
            <label className="checkbox" key={c.id}>
              <input
                type="checkbox"
                name="serviceIds"
                value={c.serviceId}
                checked={selected.includes(c.serviceId)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, c.serviceId]
                      : selected.filter((id) => id !== c.serviceId),
                  )
                }
              />
              {c.name} <b>{money(c.price)}</b>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Employees working on this vehicle</legend>
          {data.staff
            .filter(
              (s: Row) =>
                s.active &&
                s.branches.some((b: Row) => b.branchId === saleBranch),
            )
            .map((s: Row) => (
              <label className="checkbox" key={s.id}>
                <input type="checkbox" name="workerIds" value={s.id} />
                {s.name}
              </label>
            ))}
        </fieldset>
        <label>
          Discount (AED) · manager / owner only
          <input
            name="discount"
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            readOnly={data.user.role === "CASHIER"}
          />
        </label>
        <VoucherCheckout
          branchId={saleBranch}
          customerId={linkedCustomer?.customer?.id}
          serviceIds={selected}
          onDiscount={setVoucherDiscount}
        />
        <div className="sale-total">
          Total incl. {data.settings.vatRate}% VAT{" "}
          <strong>{money(total)}</strong>
        </div>
        {input(
          "paid",
          "Amount collected now (AED; zero allowed)",
          "number",
          "0",
        )}
        {select(
          "method",
          "Payment method",
          ["CASH", "CARD", "TRANSFER", "OTHER"].map((x) => ({
            value: x,
            label: x,
          })),
        )}
        <p className="note">
          A sale represents completed services. Uncollected amounts remain on
          the invoice. Shared team work never duplicates revenue.
        </p>
      </>
    );
  }
  if (kind === "payment")
    return (
      <>
        <input type="hidden" name="requestKey" value={key} />
        <p>Invoice {r.number}</p>
        {input("amount", "Payment collected (AED)", "number")}
        {select(
          "method",
          "Payment method",
          ["CASH", "CARD", "TRANSFER", "OTHER"].map((x) => ({
            value: x,
            label: x,
          })),
        )}
      </>
    );
  if (kind === "cancel")
    return (
      <>
        <p>Cancel unpaid invoice {r.number}. This action is audited.</p>
        {input("reason", "Cancellation reason")}
      </>
    );
  return null;
}

function CostEditor({
  branchId,
  initialPrice,
  initialCosts,
}: {
  branchId: string;
  initialPrice: string;
  initialCosts: Cost[];
}) {
  const [price, setPrice] = useState(initialPrice),
    [costs, setCosts] = useState<Cost[]>(initialCosts);
  const update = (i: number, key: keyof Cost, value: string) =>
    setCosts(costs.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
  let cost = D(0),
    margin = "0";
  try {
    cost = serviceCost(price || 0, costs);
    if (D(price || 0).gt(0))
      margin = D(price).minus(cost).div(price).mul(100).toFixed(1);
  } catch {}
  return (
    <>
      <label>
        Selling price (AED, excluding VAT)
        <input
          name={`price_${branchId}`}
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <input
        type="hidden"
        name={`costs_${branchId}`}
        value={JSON.stringify(costs)}
      />
      <div className="cost-editor">
        {costs.map((c, i) => (
          <div className="cost-component" key={i}>
            <label>
              Component
              <input
                aria-label={`Component ${i + 1}`}
                value={c.name}
                onChange={(e) => update(i, "name", e.target.value)}
                required
              />
            </label>
            <label>
              Calculation
              <select
                value={c.mode}
                onChange={(e) => update(i, "mode", e.target.value)}
              >
                <option value="FIXED">Fixed AED</option>
                <option value="PERCENT">% of price</option>
                <option value="QUANTITY">Quantity × unit cost</option>
              </select>
            </label>
            <label>
              {c.mode === "PERCENT" ? "Percent" : "Amount / unit AED"}
              <input
                aria-label={`Amount ${i + 1}`}
                type="number"
                min="0"
                step="0.01"
                value={c.amount}
                onChange={(e) => update(i, "amount", e.target.value)}
                required
              />
            </label>
            {c.mode === "QUANTITY" && (
              <label>
                Quantity
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={c.quantity ?? "1"}
                  onChange={(e) => update(i, "quantity", e.target.value)}
                  required
                />
              </label>
            )}
            <label>
              Cost source
              <select
                value={c.source ?? "DIRECT"}
                onChange={(e) => update(i, "source", e.target.value)}
              >
                <option value="DIRECT">Direct incremental cost</option>
                <option value="PAYROLL">Salaried labor (excluded)</option>
              </select>
            </label>
            <button
              type="button"
              className="link"
              onClick={() => setCosts(costs.filter((_, j) => i !== j))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          setCosts([
            ...costs,
            {
              name: "New component",
              mode: "FIXED",
              amount: "0",
              source: "DIRECT",
            },
          ])
        }
      >
        + Cost component
      </button>
      <div className="cost-summary">
        <span>
          Estimated cost <b>{money(cost)}</b>
        </span>
        <span>
          Contribution <b>{money(D(price || 0).minus(cost))}</b>
        </span>
        <span>
          Margin <b>{margin}%</b>
        </span>
      </div>
    </>
  );
}
