# Protune implementation plan

Next.js App Router and TypeScript provide responsive pages, server authentication, and validated mutation endpoints. Prisma stores records in PostgreSQL. Decimal arithmetic handles calculations; PostgreSQL DECIMAL stores money. Revenue excludes VAT, cash collected is stored separately, and employee assignments never duplicate sale rows. The UI refreshes every 30 seconds; it does not use a streaming transport.

## Operational foundation

Branches, individual employee accounts and assignments, customizable categories and services, branch prices and cost components, completed service sales, partial payments, receipts, operating expenses, dashboard, and audit trail. Owner, manager, cashier, and technician each have server-enforced access. Cashiers cannot discount; managers and owners can. Cancellation is limited to unpaid invoices. Refunds and live job progress require later workflows.

Sale creation and payment mutations are atomic. Idempotency keys prevent duplicate submission. Payment and cancellation use invoice row locks. Costs, VAT, service names, and prices are snapshotted. Category/service deactivation preserves history. Financial roles see costs and salaries; cashiers see operational invoice values; technicians see assigned completed service records. Salaries in profiles do not automatically post expenses. Recurring commitments are not evidence of cash payments.

## Financial conventions

Selling prices exclude VAT. Fixed, quantity, and percentage costs use undiscounted price; discount lowers contribution, not consumption. Salaried labor tagged PAYROLL is excluded from direct costs; monthly salaries must be recorded as expenses. Water, electricity, and consumables entered as service costs must not also be entered in full as operating expenses: record only unallocated residuals. Phase 1 has no material consumption ledger to reconcile allocation automatically.

Reports distinguish net revenue, estimated service costs, contribution, allocated operating expenses, other expenses/tax, and cash flow. Annual expenses allocate 1/12 each month; daily allocations preserve monthly totals to the cent. ExpenseRevision preserves effective-month history. PeriodClose snapshots completed, reconciled months and prevents changes affecting closed periods; reopening is not implemented. Later collections on old invoices appear in the collection month without changing closed sales reports. Service/team/payment filters return selected contribution, with overhead-dependent profit unavailable rather than inventing an allocation.

ForecastConfig stores branch assumptions and targets. Forecasts retain actual month-to-date revenue/costs and apply conservative, expected, and optimistic assumptions to remaining days. Automatic forecasts use weekday history when enough calendar history exists, otherwise the month-to-date daily average including zero-sales days. These are current estimates, not archived predictions. Weighted break-even uses observed or editable service mix; nonpositive margins have no finite break-even.

Investment separates capital commitments from refundable deposits. CashMovement records actual payments, operating outflows and deposit returns without creating duplicate P&L expenses. ROI distinguishes estimated profit from cash recovery. Projected payback requires owner reconciliation through the as-of date and an explicit positive monthly operating-cash assumption. Cash-changing mutations invalidate an affected reconciliation. Branch locks serialize period closing with financial writes. Excel, PDF and CSV exports enforce the same permissions and scope as reports.

## Workshop operations (Phase 3)

JobCard stores durable customer/vehicle snapshots alongside optional CRM links. QuotationRevision and QuotationApproval preserve prices, VAT, material recipes and approval evidence. New revisions invalidate previous approval. JobAssignment, JobEvent and TechnicianTime track team progress and work sessions. Job completion freezes actual consumption cost; a unique linked Sale provides one invoice. Quotes create no revenue. Customer approval is recorded by authorized staff; this is not a customer portal or messaging integration.

InventoryItem defines shared SKUs; BranchStock holds separate weighted-average quantities, costs, reorder levels and locations. StockMovement is append-only; corrections use audited adjustments rather than deletion. Branch locks serialize receipts, adjustments, transfers and consumption. Transfers lock both branches in sorted order. Request keys and job state locks prevent duplicate deductions and invoices. Receipts/transfer values are not additional P&L expenses or cash payments. A recipe replaces specified direct-cost components with actual stock consumption; changes to replaced component names require updating the recipe first. Inventory purchase cash is recorded separately.

Attendance is configurable and separate from job timers. Partial unique indexes prevent overlapping open clocks per employee. Technician data omits commercial values, customer contact details and stock costs. Productivity prorates shared revenue to cents, labels associated work counts as overlapping, clips working intervals to the Dubai reporting period and excludes cancelled invoices. Refunds and stock returns remain unavailable; consumed invoices cannot use unpaid cancellation.

## Staged module design

- Phase 4: Customer, Vehicle, Consent, Recommendation. Invoice snapshots remain durable when customer details change. Optional CRM and scoped contact visibility.
- Phase 5: Campaign, Voucher, VoucherRedemption, Referral, MarketingConfig, MarketingDelivery and MarketingEvent; loyalty progress is computed from paid invoices. Unique reward and redemption keys, transactional checkout redemption, consent enforcement, deduplicated outbox, approved WhatsApp templates and external secret storage.
- Phase 6: Permission and financial regression tests, penetration and load testing, backup restoration drills, accessibility and mobile usability, monitoring, and approved deployment.

Later entities link to existing Branch, User, Service, Sale, and Payment IDs. Keep later workflows separate from completed-service checkout. Move to each later phase only after owner approval.

## Production controls to complete

Use a managed PostgreSQL server, TLS, a secrets manager, independent accounts, a reviewed VAT configuration/TRN, durable login throttling and monitoring, accountant-reviewed closing procedures, tested encrypted backups, retention policy, and consent review. Sample data must be removed from a separate empty production database. Local Prisma development PostgreSQL is for one-user evaluation only. Do not publicly deploy before owner review and approval.

## Phase 4 CRM

Customer/vehicle links retain original invoice and job snapshots. Shared profile mutation locks assigned branches in sorted order and requires access to all of them; owner alone changes branch grants. Duplicate normalized mobile numbers and active plates are checked within assigned branches. Consent events are append-only, contact edits revoke the changed channel, and new profiles opt out. CRM is disabled by default. Existing linked job invoicing works while disabled. Customer exports expose commercial totals, never service costs or technician-only data; manager notes are omitted for cashiers. Historical attribution is explicit and does not rewrite financial snapshots.

## Phase 5 marketing

Campaigns define immutable issued reward rules and optional approved template configuration. Voucher rules are snapshotted at issuance; one voucher belongs to one registered customer. A unique redemption references exactly one invoice. A global transaction advisory lock serializes marketing mutations and sale/payment/cancellation hooks so cross-branch eligibility and limits remain consistent. Database uniqueness backs application checks. Redemption and invoice discount/VAT calculations commit atomically. Cancelling an unpaid invoice voids its redemption and permanently revokes the voucher.

Fully paid invoice hooks and a separate background worker evaluate next-visit, paid-visit/spending loyalty and referral rules. Reactivation keys combine campaign, customer and latest completed visit, suppressing duplicate inactivity-cycle rewards. The outbox captures a stable destination/message and private opt-out token, but frontend selections exclude destinations, message bodies, tokens, provider IDs and credentials. Campaign scope and reports respect branch permissions; cashiers do not receive campaign costs or profitability.

Delivery claims run under a short transaction and external network calls occur afterward. Configuration and consent are checked at claim time. Accepted versus delivered status is explicit. SMTP uses required TLS and stable Message-ID; Resend uses idempotency keys; WhatsApp uses official approved-template sends. Provider rejections can be reviewed/retried; unknown acceptance never retries automatically. Signed webhook events are deduplicated and do not downgrade delivered status. Public opt-out requires confirmation and records immutable consent evidence. Live delivery is gated by both server environment and owner settings, and fictional contacts are suppressed.
