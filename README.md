# Protune Auto Services — Phases 1–6

Working branch operations application: Next.js, TypeScript, Prisma, PostgreSQL. Fictional sample data is labeled throughout. No default password is shipped.

## Run locally

Requirements: Node 22.12+, pnpm 11.19.0, PostgreSQL 16+ or Prisma local development PostgreSQL.

```sh
pnpm install
cp .env.example .env
# Edit DATABASE_URL, APP_ORIGIN, SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD.
# Use a unique password of at least 12 characters.
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev
```

Open http://127.0.0.1:3000 and sign in using your configured owner account. APP_ORIGIN must exactly match the URL used in the browser. The development server binds only to loopback. Seeding refuses databases containing accounts. To use an empty real database, use the owner-only bootstrap command below instead of seeding fictional operations.

```sh
pnpm bootstrap
```

For local PostgreSQL without Docker, run `pnpm db:local`, retain that process, and copy its displayed DATABASE_URL into `.env`. Append `&pgbouncer=true` to the local URL if prepared-statement conflicts occur (the provisioned evaluation instance already includes this setting). Do not use that development instance in production. The locally provisioned evaluation credentials, if present, are in `.local/access.txt` (excluded from version control).

## Verify

```sh
pnpm test
pnpm typecheck
pnpm build
# With the database and server running:
pnpm test:integration
pnpm test:phase2
pnpm test:phase3
```

## Use

Owner: overview, sales, catalog, employees/accounts, branches, expenses, VAT settings, audits. Managers: assigned branch finances, expenses, sales, and team viewing. Cashiers: assigned branch checkout and payments, no discounts or financial costs. Technicians: their completed service assignments. Add employee accounts with individual passwords and assigned branches. Configure prices/costs and expenses before recording real operations. Transactions represent completed services; garage job cards now track quotation approval, workshop progress, technician timers, and completed-job invoices.

For services, costs use editable form components (FIXED AED, PERCENT of price, QUANTITY × unit cost). Tag salaried labor PAYROLL so it is excluded from direct cost. Record salaries once as operating expenses. Catalog and branch deactivation prevents new transactions and preserves previous ones. New sales snapshot pricing, service names, costs, and VAT. Receipt pages support browser print/save PDF. Cancellation is permitted only for unpaid invoices; refunds are not yet implemented.

Revenue is VAT-exclusive. Customer balance includes VAT. Operating profit uses estimated service costs and allocated operating expenses. Net profit additionally deducts separately entered other expenses and taxes; these are not calculated automatically. Cash flow uses VAT-inclusive customer payments and explicitly posted cash movements. Recurring expense revisions preserve history by effective month. Closed monthly reports are immutable. New categories, prices, salaries, branch assignments, and rules require no code changes.

## Scope and review

See [architecture and remaining phases](docs/ARCHITECTURE.md) and [deployment/backup guide](docs/OPERATIONS.md). Phase 2 provides three forecast scenarios, targets, weighted break-even calculations, capital/deposit tracking, a cash journal, ROI, historical expense revisions, monthly closing, and CSV/Excel/PDF reports. Owners manage financial assumptions and close reconciled completed months; managers can view assigned branch reports. Phase 3 adds job cards, quotation revision and approval records, team assignments, time recording, configurable attendance, weighted-cost branch inventory, reorder alerts, paired transfers, service material recipes, and productivity/inventory exports. Phases 4–5 provide CRM, vouchers, messaging, campaigns and loyalty. Phase 6 adds hardening, recovery tooling and deployment documentation. Public deployment remains unconfigured.

## Workshop workflow

Create a job card with customer/vehicle details and assign employees. Inspect the vehicle, prepare a quotation containing catalog services, extra labor charges and stock parts, then record actual customer approval with evidence. Each revision requires new approval. An assigned technician can start approved work, record time, and update progress. Stop timers before completion. Completion consumes quoted stock exactly once at current weighted cost and freezes actual material costs. Generate the invoice once; record partial payments in Sales, then mark delivered. Delivery does not silently settle an outstanding balance.

Owners define shared inventory items; owners/managers receive and adjust assigned branch stock. Set reorder levels and storage locations per branch. Transfers require access to both branches and preserve source cost. Receipts/adjustments are stock entries, not expense or cash postings: record actual cash payments separately. Service recipes identify each estimated cost component replaced by tracked stock. Checkout automatically consumes configured quantities; insufficient stock rolls back the whole transaction. Quotes estimate material cost; invoices retain completion cost snapshots. Salaried payroll stays separate.

Productivity reports use recorded timers and attendance rather than scheduled hours. Shared invoice revenue is allocated equally to workers with cent reconciliation; associated work counts overlap. There is no automatic payroll, attendance correction, return/restock, or refund workflow. Managers can stop a stuck job timer with an audited reason. Completed stock-consuming work cannot be cancelled through unpaid-invoice cancellation.

Fictional workshop samples can be added only in sample mode using `node --env-file=.env --import tsx scripts/seed-operations.ts`; this posts no revenue or stock movements. Never run sample seeding against a real operating database.

## Phase 4 — customer and vehicle management

Optional CRM supports branch-scoped profiles, multiple registered vehicles, invoice/job history, current balances, recommendations, and protected spending exports. Enable it from Customers as owner. Disable it to hide profiles while retaining records and allowing existing jobs to invoice. Walk-in checkout remains available. Profiles begin opted out; managers record explicit evidence for channel consent. Changing a contact revokes its consent.

Owner-controlled branch sharing requires managers to have all linked branch grants to edit a shared profile. History and exports remain scoped to the branches the viewer can access. Historical attribution is manual and preserves invoice snapshots and financial period records. Cancellation and uninvoiced jobs do not count as spending. Date filters use Dubai invoice dates; paid and outstanding amounts reflect current collections.

Run `pnpm test:phase4` with the local server/database running. Fictional preview profiles can be added only in sample mode with `node --env-file=.env --import tsx scripts/seed-crm.ts`. Customer merging/deletion, refunds, and production deployment remain unavailable. Phase 5 marketing is implemented below. Phase 6 local hardening and recovery verification are complete; production setup remains required.

## Phase 5 — marketing automation

Owner-configured promotions support percentages, fixed AED, one free eligible service, next-visit rewards, paid-visit/spending loyalty, referrals, and inactivity campaigns. Campaigns can span branches and eligible services. Cashiers redeem registered-customer codes at checkout; voucher discounts cannot stack with manual discounts. Redemption, VAT, financial snapshots, and one-use status commit together. Campaign rules become immutable after issuance; pause campaigns or create a new version to change rules. Limits cap issued vouchers and redemptions. Cancellation voids the redeemed voucher rather than allowing reuse.

Rewards qualify only after full settlement, using campaign dates and eligible historical service values. A referral must be registered before the referred customer has any invoice. Reactivation uses the latest completed invoice, including an unpaid return visit, and issues once per campaign/inactivity cycle. Repeated worker runs do not duplicate rewards. New profiles opt out. Automatic issuance respects preferred/selected-channel consent; missing consent suppresses delivery. Sample messages are always suppressed.

Marketing views show loyalty/referral activity, digital vouchers, delivery state, and date/branch-filtered CSV/Excel/PDF reports. Estimated contribution deducts historical direct costs and the full campaign budget allocated equally to branches; overhead and incremental lift are excluded. SMTP acceptance does not prove delivery to the inbox.

Use `pnpm marketing:worker` alongside the web process for minute-by-minute evaluation and delivery; `pnpm marketing:once` runs one cycle. The owner can evaluate rewards and process delivery manually. Live delivery is disabled by default. Configure provider credentials in secure environment variables, a public HTTPS origin, then enable owner delivery settings. Never paste keys into chat or browser forms. See [marketing setup](docs/MARKETING.md). Tests use injected providers and send no real messages.

Run `pnpm test:phase5` with the server/database running. The sample-only script `node --env-file=.env --import tsx scripts/seed-marketing.ts` creates fictional opted-out vouchers without financial postings.

## Phase 6 — release readiness

Bounded requests, persistent login throttling, security headers, protected health checks, accessible dialogs, database indexes and financial constraints are implemented. Encrypted backup/restore tools include a restore drill and scheduling templates. Run `pnpm test:phase6`, `pnpm test:load`, `pnpm test:recovery` and `pnpm test:browser` against the local evaluation workspace. Browser checks require Chromium or BROWSER_EXECUTABLE. Production configuration is checked with `pnpm deploy:preflight`. See [deployment and recovery](docs/DEPLOYMENT.md) and [verified results and limits](docs/VERIFICATION.md). No public hosting or live messaging is configured.
