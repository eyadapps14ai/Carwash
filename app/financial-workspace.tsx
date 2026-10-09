"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Download,
  Settings2,
  X,
  ArrowUpRight,
  LockKeyhole,
  TrendingUp,
} from "lucide-react";
import { D, money, dubaiDate, period } from "@/lib/finance";
import {
  FinanceData,
  ForecastSettings,
  defaultForecast,
  forecastCompany,
  forecastBranch,
  catalogMix,
  breakEven,
  investmentROI,
  buildReport,
  monthStart,
  monthEnd,
  expenseMonth,
  resolveExpense,
  decimalSum,
  dateOnly,
  FinancialReport,
  InvestmentRecord,
  cashAt,
} from "@/lib/intelligence";
// All financial data is server-scoped before it reaches this component.
type Props = {
  tab: string;
  data: FinanceData;
  branch: string;
  date: string;
  owner: boolean;
  staff: { id: string; name: string }[];
};
type Modal = {
  kind:
    | "forecastConfig"
    | "investment"
    | "cashMovement"
    | "voidCash"
    | "closeMonth";
  row?: Record<string, any>;
};
const metric = (label: string, value: string, note: string, tone = "") => (
  <div className={`stat ${tone}`}>
    <span>
      {label}
      <ArrowUpRight size={15} />
    </span>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>
);
const currency = (value: string | null) =>
  value === null ? "Unavailable" : money(value);
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
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={heads.length} className="empty">
              No records for this period. Add real entries when available.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
export default function FinancialWorkspace({
  tab,
  data,
  branch,
  date,
  owner,
  staff,
}: Props) {
  const router = useRouter(),
    asOf = date > dubaiDate() ? dubaiDate() : date,
    branchIds = data.branches
      .filter((b) => branch === "all" || b.id === branch)
      .map((b) => b.id),
    branchName = (id: string) =>
      data.branches.find((b) => b.id === id)?.code ?? id;
  const [modal, setModal] = useState<Modal | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const open = (kind: Modal["kind"], row?: Record<string, any>) => {
    setError("");
    setModal({ kind, row });
  };
  async function mutate(action: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setModal(null);
      setMessage("Financial records saved. Calculations updated.");
      router.refresh();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  const forecast = useMemo(
    () => forecastCompany(data, branchIds, asOf),
    [data, branch, asOf],
  );
  const actual = buildReport(data, {
    branchIds,
    start: monthStart(asOf),
    end: asOf,
  }).summary;
  return (
    <>
      <div className="financial-toolbar">
        <div>
          <span className="badge">FINANCIAL INTELLIGENCE</span>
          <p>
            As of {asOf} · Forecasts and service profitability include estimates
          </p>
        </div>
        {owner && tab === "Forecast" && (
          <button onClick={() => open("forecastConfig")}>
            <Settings2 size={16} /> Assumptions & targets
          </button>
        )}
        {owner && tab === "Investment & ROI" && (
          <div className="actions">
            <button className="secondary" onClick={() => open("cashMovement")}>
              <Plus size={16} /> Cash entry
            </button>
            <button onClick={() => open("investment")}>
              <Plus size={16} /> Investment / deposit
            </button>
          </div>
        )}
        {owner && tab === "Reports" && (
          <button className="secondary" onClick={() => open("closeMonth")}>
            <LockKeyhole size={16} /> Close a month
          </button>
        )}
      </div>
      {message && <div className="success">{message}</div>}
      {tab === "Forecast" && (
        <>
          <div className="stats">
            {metric(
              "MTD net revenue",
              money(actual.revenue),
              "Recorded completed invoices · VAT excluded",
            )}
            {metric(
              "MTD allocated expenses",
              money(
                D(actual.serviceCosts)
                  .plus(actual.operatingExpenses)
                  .plus(actual.otherExpenses)
                  .plus(actual.taxExpenses)
                  .toString(),
              ),
              "Service estimates + recognized allocations",
            )}
            {metric(
              "MTD operating profit · est.",
              currency(actual.operatingProfit),
              "Expenses recognized through selected date",
              D(actual.operatingProfit ?? 0).gte(0) ? "green" : "red",
            )}
            {metric(
              "Expected month-end net profit",
              money(forecast.scenarios[1].netProfit),
              "After recorded other / tax expense allocations",
              D(forecast.scenarios[1].netProfit).gte(0) ? "green" : "red",
            )}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Month-end scenarios</h2>
                <p>
                  {asOf.slice(0, 7)} · Sum of branch-specific forecasts · Actual
                  results stay unchanged
                </p>
              </div>
              <TrendingUp size={20} />
            </div>
            <div className="scenario-grid">
              {forecast.scenarios.map((s) => (
                <div
                  key={s.name}
                  className={`scenario-card ${s.name === "Expected" ? "expected" : ""}`}
                >
                  <span>{s.name.toUpperCase()}</span>
                  <h3>{money(s.revenue)}</h3>
                  <small>Forecast net revenue</small>
                  <div>
                    <span>Remaining revenue</span>
                    <b>{money(s.remainingRevenue)}</b>
                  </div>
                  <div>
                    <span>Total estimated expenses</span>
                    <b>{money(s.totalExpenses)}</b>
                  </div>
                  <div>
                    <span>Operating profit · estimate</span>
                    <b
                      className={
                        D(s.operatingProfit).gte(0)
                          ? "positive-text"
                          : "negative-text"
                      }
                    >
                      {money(s.operatingProfit)}
                    </b>
                  </div>
                  <div>
                    <span>Net profit · estimate</span>
                    <b>{money(s.netProfit)}</b>
                  </div>
                  <div>
                    <span>Net margin</span>
                    <b>{s.margin === null ? "Unavailable" : `${s.margin}%`}</b>
                  </div>
                </div>
              ))}
            </div>
            <p className="note pad">
              Forecast revenue = actual MTD + remaining-day baseline × scenario
              multiplier. Future service costs use the observed cost ratio and
              the configured cost multiplier. Known expense commitments are
              retained; additional planned expenses apply only to remaining
              days. Income tax is not calculated automatically.
            </p>
          </section>
          <div className="financial-branch-grid">
            {forecast.branches.map((b) => (
              <section key={b.branchId} className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {data.branches.find((r) => r.id === b.branchId)?.name}
                    </h2>
                    <p>{b.method}</p>
                  </div>
                  <span
                    className={
                      b.onTrack === null
                        ? "badge"
                        : b.onTrack
                          ? "badge positive"
                          : "badge negative"
                    }
                  >
                    {b.onTrack === null
                      ? "No targets set"
                      : b.onTrack
                        ? "On track"
                        : "Below target"}
                  </span>
                </div>
                <div className="forecast-progress">
                  <div>
                    <span>Average daily revenue</span>
                    <b>{money(b.averageDailyRevenue)}</b>
                  </div>
                  <div>
                    <span>Days elapsed / remaining</span>
                    <b>
                      {b.elapsed} / {b.remaining}
                    </b>
                  </div>
                  <div>
                    <span>Revenue target</span>
                    <b>
                      {D(b.cfg.revenueTarget).gt(0)
                        ? money(b.cfg.revenueTarget)
                        : "Not set"}
                    </b>
                  </div>
                  <div>
                    <span>Revenue still needed</span>
                    <b>{money(b.neededRevenue)}</b>
                  </div>
                  <div>
                    <span>Daily revenue needed</span>
                    <b>{currency(b.requiredDailyRevenue)}</b>
                  </div>
                  <div>
                    <span>Daily service lines needed</span>
                    <b>{b.requiredDailyServices ?? "Unavailable"}</b>
                  </div>
                  <div>
                    <span>Additional daily services above expected</span>
                    <b>{b.additionalDailyServices ?? "Unavailable"}</b>
                  </div>
                  <div>
                    <span>Operating profit target</span>
                    <b>
                      {D(b.cfg.profitTarget).gt(0)
                        ? money(b.cfg.profitTarget)
                        : "Not set"}
                    </b>
                  </div>
                  {owner && (
                    <button
                      className="link"
                      onClick={() => open("forecastConfig", b.cfg)}
                    >
                      Edit branch assumptions →
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {tab === "Break-even" && (
        <BreakEvenView data={data} branchIds={branchIds} asOf={asOf} />
      )}
      {tab === "Investment & ROI" && (
        <>
          <div className="note financial-notice">
            Operating profit excludes VAT and uses cost estimates. Recorded cash
            includes customer receipts with VAT and actual journal entries.
            Payroll/service cost estimates do not create cash payments. Enter
            actual outflows separately; capital and deposits are excluded from
            operating expenses.
          </div>
          <div className="financial-branch-grid">
            {branchIds.map((id) => {
              const r = investmentROI(data, id, asOf);
              return (
                <section className="panel" key={id}>
                  <div className="panel-heading">
                    <div>
                      <h2>{data.branches.find((b) => b.id === id)?.name}</h2>
                      <p>
                        Cash cumulatives start at the first capital acquisition;
                        otherwise this month
                      </p>
                    </div>
                    <span
                      className={
                        r.reviewed ? "badge positive" : "badge warning"
                      }
                    >
                      {r.reviewed ? "Cash reviewed" : "Journal not reconciled"}
                    </span>
                  </div>
                  <div className="roi-top">
                    <span>Capital investment commitment</span>
                    <strong>{money(r.capitalAmount)}</strong>
                    <small>Refundable deposits excluded</small>
                  </div>
                  <div className="forecast-progress">
                    {[
                      ["Capital actually paid", money(r.capitalPaid)],
                      ["Refundable deposits held", money(r.depositHeld)],
                      [
                        "MTD operating profit · estimated",
                        currency(r.monthlyOperatingProfit),
                      ],
                      [
                        "MTD operating return",
                        r.monthlyOperatingReturn === null
                          ? "Unavailable"
                          : `${r.monthlyOperatingReturn}%`,
                      ],
                      [
                        "Cumulative operating profit · estimated",
                        money(r.cumulativeOperatingProfit),
                      ],
                      [
                        "Recorded operating cash movement",
                        money(r.cumulativeOperatingCash),
                      ],
                      [
                        "Recorded total cash movement",
                        money(r.cumulativeCashFlow),
                      ],
                      [
                        "Investment still to recover",
                        currency(r.remainingInvestment),
                      ],
                      [
                        "Owner monthly cash assumption",
                        money(r.recoveryMonthlyCash),
                      ],
                      [
                        "Projected remaining payback",
                        r.paybackMonths === null
                          ? "Unavailable"
                          : `${r.paybackMonths} months`,
                      ],
                      [
                        "Projected recovery date",
                        r.projectedRecoveryDate ?? "Unavailable",
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                    <p className="note">
                      Recovery requires cash reconciliation through {asOf} and a
                      positive monthly cash assumption. Estimated operating
                      profit is not used as a cash-flow substitute. Financing
                      and deposit movements do not count toward operating
                      recovery.
                    </p>
                    {owner && (
                      <button
                        className="link"
                        onClick={() =>
                          open("forecastConfig", {
                            ...defaultForecast(id),
                            ...data.forecastConfigs.find(
                              (c) => c.branchId === id,
                            ),
                          })
                        }
                      >
                        Review cash & recovery assumption →
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Capital investments & refundable deposits</h2>
                <p>Commitment amounts are distinct from actual payments</p>
              </div>
            </div>
            {table(
              [
                "Date",
                "Branch",
                "Category",
                "Description",
                "Commitment",
                "Recorded net paid",
                "Type",
                ...(owner ? [""] : []),
              ],
              data.investments
                .filter(
                  (i) =>
                    branchIds.includes(i.branchId) && dateOnly(i.date) <= asOf,
                )
                .map((i) => {
                  const paid = data.cashMovements
                    .filter((c) => c.investmentId === i.id && cashAt(c, asOf))
                    .reduce(
                      (n, c) =>
                        c.direction === "OUT"
                          ? n.plus(c.amount)
                          : n.minus(c.amount),
                      D(0),
                    );
                  return [
                    dateOnly(i.date),
                    branchName(i.branchId),
                    i.category,
                    i.description,
                    money(i.amount),
                    money(paid),
                    <span key="t" className="badge">
                      {i.kind}
                      {i.sample ? " · SAMPLE" : ""}
                    </span>,
                    ...(owner
                      ? [
                          <button
                            key="e"
                            className="link"
                            onClick={() => open("investment", i)}
                          >
                            Edit
                          </button>,
                        ]
                      : []),
                  ];
                }),
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Cash journal</h2>
                <p>
                  Customer invoice payments are added automatically to cash
                  reports; do not enter them again here.
                </p>
              </div>
            </div>
            {table(
              [
                "Date",
                "Branch",
                "Direction",
                "Category",
                "Description",
                "Amount",
                "State",
                ...(owner ? [""] : []),
              ],
              data.cashMovements
                .filter(
                  (c) =>
                    branchIds.includes(c.branchId) && dateOnly(c.date) <= asOf,
                )
                .map((c) => [
                  dateOnly(c.date),
                  branchName(c.branchId),
                  c.direction,
                  c.category,
                  c.description,
                  money(c.amount),
                  c.voidedAt ? "Voided" : "Recorded",
                  ...(owner
                    ? [
                        !c.voidedAt ? (
                          <button
                            key="v"
                            className="link"
                            onClick={() => open("voidCash", c)}
                          >
                            Void
                          </button>
                        ) : null,
                      ]
                    : []),
                ]),
            )}
          </section>
        </>
      )}
      {tab === "Reports" && (
        <ReportsView data={data} branch={branch} asOf={asOf} staff={staff} />
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Financial settings"
          >
            <div className="panel-heading">
              <h2>
                {
                  {
                    forecastConfig: "Assumptions & targets",
                    investment: "Investment / deposit",
                    cashMovement: "Record actual cash movement",
                    voidCash: "Void cash entry",
                    closeMonth: "Close a financial month",
                  }[modal.kind]
                }
              </h2>
              <button
                aria-label="Close financial dialog"
                className="icon-button"
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </div>
            <FinanceForm
              key={`${modal.kind}-${modal.row?.branchId ?? modal.row?.id ?? "new"}`}
              modal={modal}
              data={data}
              branch={branch}
              asOf={asOf}
              busy={busy}
              error={error}
              save={mutate}
            />
          </section>
        </div>
      )}
    </>
  );
}
function BreakEvenView({
  data,
  branchIds,
  asOf,
}: {
  data: FinanceData;
  branchIds: string[];
  asOf: string;
}) {
  const [mode, setMode] = useState<"observed" | "custom">("observed"),
    [weights, setWeights] = useState<Record<string, number>>({}),
    [volume, setVolume] = useState(600),
    [overheadOverride, setOverheadOverride] = useState("");
  const month = asOf.slice(0, 7),
    report = buildReport(data, {
      branchIds,
      start: monthStart(month),
      end: asOf,
    }),
    catalog = catalogMix(data, branchIds);
  const fixed = data.expenses
      .filter(
        (e) =>
          branchIds.includes(e.branchId) &&
          resolveExpense(e, month)?.kind === "FIXED",
      )
      .reduce((n, e) => n.plus(expenseMonth(e, month)), D(0)),
    variable = decimalSum(
      report.expenseRows
        .filter((e) => e.kind === "VARIABLE")
        .map((e) => e.amount),
    ),
    overheadAuto = D(report.summary.revenue).gt(0)
      ? variable.div(report.summary.revenue).mul(100).toFixed(2)
      : "0",
    unknownVariable =
      variable.gt(0) &&
      D(report.summary.revenue).eq(0) &&
      overheadOverride === "";
  const items =
    mode === "observed" && report.summary.services
      ? report.serviceRows.map((s) => ({
          price: D(s.revenue).div(s.count).toFixed(8),
          cost: D(s.cost).div(s.count).toFixed(8),
          weight: s.count,
        }))
      : catalog.map((c) => ({ ...c, weight: weights[c.id] ?? 1 }));
  const result = unknownVariable
      ? null
      : breakEven(
          fixed.toString(),
          items,
          period(month).days,
          overheadOverride || overheadAuto,
        ),
    profit = result ? D(result.rawContribution).mul(volume).minus(fixed) : null;
  const monthlyContribution = D(report.summary.contribution).minus(variable),
    progress = fixed.gt(0)
      ? Math.max(
          0,
          Math.min(100, monthlyContribution.div(fixed).mul(100).toNumber()),
        )
      : 100;
  return (
    <>
      <div className="stats">
        {metric(
          "Monthly fixed expenses",
          money(fixed),
          "Recorded fixed operating commitments",
        )}
        {metric(
          "Contribution per service",
          result ? money(result.contribution) : "Unavailable",
          "After estimated service and variable overhead",
        )}
        {metric(
          "Break-even revenue",
          currency(result?.monthlyRevenue ?? null),
          "Fixed expenses ÷ contribution margin",
        )}
        {metric(
          "Daily services to break even",
          result?.dailyServices === null || !result
            ? "Unavailable"
            : String(result.dailyServices),
          "Rounded up across calendar days",
        )}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Progress toward monthly break-even</h2>
            <p>
              Recorded service contribution less recognized variable overhead
              versus full fixed commitments
            </p>
          </div>
          <b>{progress.toFixed(1)}%</b>
        </div>
        <div className="progress-track">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="break-even-summary">
          <span>
            Contribution to date <b>{money(monthlyContribution)}</b>
          </span>
          <span>
            Monthly service lines required{" "}
            <b>{result?.monthlyServices ?? "Unavailable"}</b>
          </span>
          <span>
            Required daily revenue{" "}
            <b>{currency(result?.dailyRevenue ?? null)}</b>
          </span>
          <span>
            Contribution margin{" "}
            <b>
              {result?.margin === null || !result
                ? "Unavailable"
                : `${result.margin}%`}
            </b>
          </span>
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Service mix</h2>
              <p>
                Observed mix uses discounted historical revenue. Custom mix uses
                current branch prices and costs.
              </p>
            </div>
          </div>
          <div className="mix-controls">
            <label>
              Calculation basis
              <select
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "observed" | "custom")
                }
              >
                <option value="observed">
                  Observed service mix{" "}
                  {report.summary.services ? "" : "(catalog fallback)"}
                </option>
                <option value="custom">Custom weighted service mix</option>
              </select>
            </label>
            <label>
              Non-service variable overhead (% of revenue)
              <input
                type="number"
                min="0"
                max="1000"
                step="0.01"
                placeholder={overheadAuto}
                value={overheadOverride}
                onChange={(e) => setOverheadOverride(e.target.value)}
              />
              <small>
                Blank uses {overheadAuto}% from recognized MTD variable
                expenses. These costs are not added to fixed expenses.
              </small>
            </label>
          </div>
          {mode === "custom" &&
            table(
              ["Branch / service", "Price", "Est. cost", "Relative weight"],
              catalog.map((c) => [
                <div key="n">
                  <b>{c.name}</b>
                  <small>
                    {data.branches.find((b) => b.id === c.branchId)?.code}
                  </small>
                </div>,
                money(c.price),
                money(c.cost),
                <input
                  key="w"
                  className="mix-weight"
                  type="number"
                  min="0"
                  max="10000"
                  step="1"
                  aria-label={`Weight ${c.name} ${c.branchId}`}
                  value={weights[c.id] ?? 1}
                  onChange={(e) =>
                    setWeights({
                      ...weights,
                      [c.id]: Math.max(0, Number(e.target.value)),
                    })
                  }
                />,
              ]),
            )}
          <p className="note pad">
            {unknownVariable
              ? "Variable overhead cannot be inferred without sales. Enter an explicit overhead percentage."
              : result && !result.viable
                ? "This mix has zero or negative contribution. No finite break-even volume exists."
                : !result
                  ? "Choose at least one positive service weight."
                  : "Break-even concerns operating profit; non-operating costs and taxes are excluded."}
          </p>
        </section>
        <section className="panel volume-panel">
          <div className="panel-heading">
            <div>
              <h2>What if service volume changes?</h2>
              <p>
                Estimated monthly operating profit at a constant service mix
              </p>
            </div>
          </div>
          <div className="volume-controls">
            <label>
              Monthly service lines
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                value={volume}
                onChange={(e) => setVolume(Math.max(0, Number(e.target.value)))}
              />
            </label>
            <input
              aria-label="Monthly service volume"
              type="range"
              min="0"
              max="3000"
              step="25"
              value={Math.min(volume, 3000)}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
            <span>Average service revenue</span>
            <b>{result ? money(result.averagePrice) : "Unavailable"}</b>
            <span>Estimated operating profit</span>
            <strong
              className={profit?.gte(0) ? "positive-text" : "negative-text"}
            >
              {profit ? money(profit) : "Unavailable"}
            </strong>
            <p className="note">
              Assumes prices, mix, variable rates, and fixed overhead remain
              unchanged. It is a scenario, not a sales forecast.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
function ReportsView({
  data,
  branch,
  asOf,
  staff,
}: {
  data: FinanceData;
  branch: string;
  asOf: string;
  staff: { id: string; name: string }[];
}) {
  const [start, setStart] = useState(monthStart(asOf)),
    [end, setEnd] = useState(asOf),
    [service, setService] = useState(""),
    [category, setCategory] = useState(""),
    [employee, setEmployee] = useState(""),
    [method, setMethod] = useState(""),
    [type, setType] = useState("Profit and loss"),
    [report, setReport] = useState<FinancialReport | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    setStart(monthStart(asOf));
    setEnd(asOf);
  }, [asOf]);
  const query = new URLSearchParams({
    start,
    end,
    branch,
    ...(service ? { service } : {}),
    ...(category ? { category } : {}),
    ...(employee ? { employee } : {}),
    ...(method ? { method } : {}),
  }).toString();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/finance?${query}`, { signal: controller.signal })
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        if (active) {
          setReport(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active && e.name !== "AbortError") {
          setError(e.message);
          setReport(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [query, data]);
  const branchName = (id: string) =>
    data.branches.find((b) => b.id === id)?.code ?? id;
  return (
    <>
      <section className="panel">
        <div className="report-controls">
          <label>
            From
            <input
              aria-label="Report from"
              type="date"
              value={start}
              onChange={(e) => {
                if (e.target.value) setStart(e.target.value);
              }}
            />
          </label>
          <label>
            Through
            <input
              aria-label="Report through"
              type="date"
              max={dubaiDate()}
              value={end}
              onChange={(e) => {
                if (e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label>
            Report
            <select
              aria-label="Report type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {[
                "Profit and loss",
                "Sales",
                "Service profitability",
                "Branch comparison",
                "Expense analysis",
                "Cash flow",
                "Daily sales",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Service
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              <option value="">All services</option>
              {data.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[
                ...new Set(
                  data.sales.flatMap((s) => s.lines.map((l) => l.category)),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Employee
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
            >
              <option value="">All employees</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">All payments</option>
              {["CASH", "CARD", "TRANSFER", "OTHER"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="export-bar">
          <span>
            {loading
              ? "Updating report…"
              : report?.closed
                ? "Immutable closed snapshot"
                : "Live report · select up to 366 days"}
          </span>
          <div>
            {["csv", "xlsx", "pdf"].map((format) => (
              <a
                key={format}
                className="export-button"
                aria-disabled={!report || loading}
                href={
                  report && !loading
                    ? `/api/export?${query}&report=${encodeURIComponent(type)}&format=${format}`
                    : undefined
                }
              >
                <Download size={14} />
                {format === "xlsx" ? "Excel" : format.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
        {error && <p className="error pad">{error}</p>}
      </section>
      {report && (
        <>
          <div className="stats">
            {metric(
              "Net revenue",
              money(report.summary.revenue),
              "Selected service revenue · VAT excluded",
            )}
            {metric(
              "Contribution",
              money(report.summary.contribution),
              "Revenue less historical estimated service costs",
            )}
            {metric(
              "Operating profit · estimated",
              currency(report.summary.operatingProfit),
              report.filtered
                ? "Unavailable with unallocated sales filters"
                : "After recognized operating expense allocations",
            )}
            {metric(
              "Net profit · estimated",
              currency(report.summary.netProfit),
              "After recorded non-operating and tax expenses",
            )}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{type}</h2>
                <p>
                  {report.start} to {report.end} ·{" "}
                  {report.sample ? "Sample data included · " : ""}AED · Dubai
                </p>
              </div>
            </div>
            {type === "Profit and loss" &&
              table(
                ["Metric", "Amount"],
                [
                  ["Net revenue", money(report.summary.revenue)],
                  [
                    "Estimated service costs",
                    money(report.summary.serviceCosts),
                  ],
                  ["Contribution", money(report.summary.contribution)],
                  [
                    "Allocated operating expenses",
                    money(report.summary.operatingExpenses),
                  ],
                  [
                    "Estimated operating profit",
                    currency(report.summary.operatingProfit),
                  ],
                  [
                    "Other recorded expenses",
                    money(report.summary.otherExpenses),
                  ],
                  ["Recorded tax expenses", money(report.summary.taxExpenses)],
                  ["Estimated net profit", currency(report.summary.netProfit)],
                  [
                    "Net margin",
                    report.summary.margin === null
                      ? "Unavailable"
                      : `${report.summary.margin}%`,
                  ],
                  [
                    "Customer receipts including VAT",
                    money(report.summary.receipts),
                  ],
                  [
                    "Recorded net cash movement",
                    currency(report.summary.recordedCashFlow),
                  ],
                  [
                    "Outstanding invoices through end date",
                    money(report.summary.outstanding),
                  ],
                ],
              )}
            {type === "Sales" &&
              table(
                [
                  "Invoice / plate",
                  "Date",
                  "Branch",
                  "Services",
                  "Net sales",
                  "Contribution",
                  "Balance",
                ],
                report.saleRows.map((s) => [
                  <div key="i">
                    <b>{s.plate}</b>
                    <small>
                      {s.number}
                      {s.sample ? " · SAMPLE" : ""}
                    </small>
                  </div>,
                  s.date,
                  branchName(s.branchId),
                  s.services,
                  money(s.net),
                  money(s.contribution),
                  money(s.outstanding),
                ]),
              )}
            {type === "Service profitability" &&
              table(
                [
                  "Service",
                  "Category",
                  "Services",
                  "Net revenue",
                  "Est. costs",
                  "Contribution",
                  "Margin",
                ],
                report.serviceRows.map((s) => [
                  s.name,
                  s.category,
                  s.count,
                  money(s.revenue),
                  money(s.cost),
                  <b
                    key="c"
                    className={
                      D(s.contribution).gte(0)
                        ? "positive-text"
                        : "negative-text"
                    }
                  >
                    {money(s.contribution)}
                  </b>,
                  s.margin === null ? "Unavailable" : `${s.margin}%`,
                ]),
              )}
            {type === "Branch comparison" &&
              table(
                [
                  "Branch",
                  "Revenue",
                  "Est. costs",
                  "Operating expenses",
                  "Est. operating profit",
                  "Est. net profit",
                  "Vehicles",
                ],
                report.branchRows.map((b) => [
                  b.name,
                  money(b.summary.revenue),
                  money(b.summary.serviceCosts),
                  money(b.summary.operatingExpenses),
                  currency(b.summary.operatingProfit),
                  currency(b.summary.netProfit),
                  b.summary.vehicles,
                ]),
              )}
            {type === "Expense analysis" &&
              table(
                [
                  "Branch",
                  "Month",
                  "Category",
                  "Type",
                  "Description",
                  "Recognized amount",
                ],
                report.expenseRows.map((e) => [
                  branchName(e.branchId),
                  e.month,
                  e.category,
                  e.kind,
                  e.description,
                  money(e.amount),
                ]),
              )}
            {type === "Cash flow" &&
              table(
                [
                  "Date",
                  "Branch",
                  "Direction",
                  "Source",
                  "Description",
                  "Amount",
                ],
                report.cashRows.map((c) => [
                  c.date,
                  branchName(c.branchId),
                  c.direction,
                  c.category,
                  c.description,
                  money(c.amount),
                ]),
              )}
            {type === "Daily sales" &&
              table(
                [
                  "Date",
                  "Net revenue",
                  "Est. costs",
                  "Contribution",
                  "Vehicles",
                  "Services",
                ],
                report.dailyRows.map((d) => [
                  d.date,
                  money(d.revenue),
                  money(d.cost),
                  money(d.contribution),
                  d.vehicles,
                  d.services,
                ]),
              )}
          </section>
          <section className="panel report-notes">
            <h2>Definitions & scope</h2>
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              Excel exports contain all available financial sheets. CSV and PDF
              contain the selected report.
            </p>
          </section>
        </>
      )}
    </>
  );
}
function FinanceForm({
  modal,
  data,
  branch,
  asOf,
  busy,
  error,
  save,
}: {
  modal: Modal;
  data: FinanceData;
  branch: string;
  asOf: string;
  busy: boolean;
  error: string;
  save: (action: string, payload: unknown) => void;
}) {
  const [selectedBranch, setSelectedBranch] = useState(
      modal.row?.branchId ?? (branch === "all" ? data.branches[0]?.id : branch),
    ),
    [kind, setKind] = useState(modal.row?.kind ?? "CAPITAL"),
    [cashCategory, setCashCategory] = useState("OPERATING"),
    [key] = useState(() => crypto.randomUUID());
  const row = modal.row ?? {},
    cfg = {
      ...defaultForecast(selectedBranch),
      ...data.forecastConfigs.find((c) => c.branchId === selectedBranch),
    };
  const input = (
    name: string,
    label: string,
    value: string | number = "",
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
        {...(type === "number" ? { min: 0, step: "0.01" } : {})}
      />
    </label>
  );
  const branchSelect = (
    <label>
      Branch
      <select
        name="branchId"
        value={selectedBranch}
        onChange={(e) => setSelectedBranch(e.target.value)}
        disabled={!!row.id}
      >
        {data.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {row.id && <input type="hidden" name="branchId" value={selectedBranch} />}
    </label>
  );
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      values: Record<string, any> = Object.fromEntries(f.entries());
    if (row.id) values.id = row.id;
    if (modal.kind === "investment") {
      values.paid = f.get("paid") === "on";
      values.kind = kind;
    }
    if (modal.kind === "cashMovement") {
      if (!values.investmentId) delete values.investmentId;
      if (!values.expenseId) delete values.expenseId;
    }
    save(modal.kind, values);
  };
  return (
    <form onSubmit={submit}>
      {!["voidCash"].includes(modal.kind) && branchSelect}
      {modal.kind === "forecastConfig" && (
        <div key={selectedBranch}>
          <label>
            Forecast method
            <select name="basis" defaultValue={cfg.basis}>
              <option value="AUTO">
                Use weekday history when available; otherwise MTD average
              </option>
              <option value="AVERAGE">
                Always use the MTD calendar-day average
              </option>
            </select>
          </label>
          <p className="note">
            Multipliers apply only to remaining revenue and future service
            costs. Recorded actuals are unchanged.
          </p>
          {input(
            "conservativePct",
            "Conservative revenue multiplier (%)",
            cfg.conservativePct,
            "number",
          )}
          {input(
            "expectedPct",
            "Expected revenue multiplier (%)",
            cfg.expectedPct,
            "number",
          )}
          {input(
            "optimisticPct",
            "Optimistic revenue multiplier (%)",
            cfg.optimisticPct,
            "number",
          )}
          {input(
            "futureCostPct",
            "Future service cost multiplier (%)",
            cfg.futureCostPct,
            "number",
          )}
          {input(
            "extraExpense",
            "Additional remaining operating expense assumption (AED)",
            cfg.extraExpense,
            "number",
          )}
          {input(
            "revenueTarget",
            "Monthly net revenue target (AED; zero = no target)",
            cfg.revenueTarget,
            "number",
          )}
          {input(
            "profitTarget",
            "Monthly operating profit target (AED; zero = no target)",
            cfg.profitTarget,
            "number",
          )}
          {input(
            "recoveryMonthlyCash",
            "Projected monthly operating cash recovery (AED; explicit assumption)",
            cfg.recoveryMonthlyCash,
            "number",
          )}
          {input(
            "cashReviewedThrough",
            "Cash journal reconciled through (leave blank if incomplete)",
            cfg.cashReviewedThrough,
            "date",
            false,
          )}
          <p className="note">
            Only mark cash reviewed after reconciling receipts, actual operating
            payments, taxes, capital and deposits. New cash entries or receipts
            invalidate the review when they affect this date. Payback dates are
            unavailable without reconciliation and a positive cash assumption.
          </p>
        </div>
      )}
      {modal.kind === "investment" && (
        <>
          <input type="hidden" name="requestKey" value={key} />
          <label>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={!!row.id}
            >
              <option value="CAPITAL">Capital investment</option>
              <option value="DEPOSIT">Refundable deposit</option>
            </select>
          </label>
          <label>
            Category
            <select
              name="category"
              defaultValue={
                row.category ??
                (kind === "DEPOSIT" ? "Refundable deposit" : "Equipment")
              }
              key={kind}
            >
              {(kind === "DEPOSIT"
                ? ["Refundable deposit"]
                : [
                    "Equipment",
                    "Renovation",
                    "Machinery",
                    "Initial setup",
                    "Other",
                  ]
              ).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {input("description", "Description", row.description ?? "")}
          {input(
            "amount",
            "Investment / deposit commitment (AED)",
            row.amount ?? "",
            "number",
          )}
          {input(
            "date",
            "Actual acquisition date",
            row.date ? dateOnly(row.date) : asOf,
            "date",
          )}
          {!row.id && (
            <label className="checkbox">
              <input type="checkbox" name="paid" />
              Also record the full amount as actually paid on this date
            </label>
          )}
          <p className="note">
            Capital and refundable deposits do not reduce operating profit.
            Partial payments and deposit returns can be recorded in the cash
            journal. Editing commitments does not rewrite past cash payments.
          </p>
        </>
      )}
      {modal.kind === "cashMovement" && (
        <>
          <input type="hidden" name="requestKey" value={key} />
          <label>
            Cash category
            <select
              name="category"
              value={cashCategory}
              onChange={(e) => setCashCategory(e.target.value)}
            >
              {[
                "OPERATING",
                "TAX",
                "OTHER",
                "FINANCING",
                "CAPITAL",
                "DEPOSIT",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select name="direction">
              <option value="OUT">Outflow / actual payment</option>
              <option value="IN">Inflow / return</option>
            </select>
          </label>
          {["CAPITAL", "DEPOSIT"].includes(cashCategory) && (
            <label>
              Linked investment / deposit
              <select
                name="investmentId"
                required
                key={`${selectedBranch}-${cashCategory}`}
              >
                <option value="">Select a record</option>
                {data.investments
                  .filter(
                    (i) =>
                      i.branchId === selectedBranch && i.kind === cashCategory,
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.description} · {money(i.amount)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {["OPERATING", "TAX", "OTHER"].includes(cashCategory) && (
            <label>
              Optional expense reference
              <select name="expenseId" key={selectedBranch}>
                <option value="">No expense reference</option>
                {data.expenses
                  .filter((e) => e.branchId === selectedBranch)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.category} · {e.description}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {input(
            "amount",
            "Actual cash amount (AED, including paid VAT where applicable)",
            "",
            "number",
          )}
          {input("date", "Actual payment date", asOf, "date")}
          {input("description", "Description / bank reference")}
          <p className="note">
            Invoice payments are already counted automatically. Do not enter
            customer receipts again. Cash entries do not create a P&L expense;
            record the related expense separately when needed.
          </p>
        </>
      )}
      {modal.kind === "voidCash" && (
        <>
          <p>
            {row.description} · {money(row.amount ?? 0)}
          </p>
          {input("reason", "Reason for voiding")}
          <p className="note">
            Voiding keeps an audit trail. Closed-month entries cannot be voided.
          </p>
        </>
      )}
      {modal.kind === "closeMonth" && (
        <>
          {input(
            "month",
            "Completed month to close",
            asOf.slice(0, 7),
            "month",
          )}
          <p className="note">
            Reconcile the branch cash journal through month end in assumptions
            first. Closing preserves a permanent report snapshot and blocks
            changes to that month. Current and future months cannot be closed.
            There is no reopening workflow in Phase 2.
          </p>
        </>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <div className="form-actions">
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : modal.kind === "closeMonth"
              ? "Close reviewed month"
              : "Save"}
        </button>
      </div>
    </form>
  );
}
