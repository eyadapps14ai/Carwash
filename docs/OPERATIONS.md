# Deployment and recovery

Public deployment requires the owner's explicit approval. This project has not been deployed publicly.

## Before deployment

- Review Phases 1–6 in the sample workspace; validate branch permissions and reconcile financial examples.
- Provision managed PostgreSQL with encryption, TLS, point-in-time recovery, monitoring and least-privilege credentials. Use a separate database from development.
- Set DATABASE_URL in the server secret store and APP_ORIGIN to the exact HTTPS application origin. Never use the local development database or its credentials in production.
- Run `pnpm db:generate`, `pnpm db:migrate`, `pnpm bootstrap`, `pnpm build`. Bootstrap uses environment-configured unique credentials; remove bootstrap password variables afterward.
- Add staff accounts with individual passwords; review assignments and inactive accounts. Sessions expire after eight hours and are revoked when profiles/passwords change.
- Review VAT/TRN, services, direct-cost allocation, recurring expense dates and payroll. Get appropriate accounting review before real invoicing. Current receipts are not certified compliance artifacts.
- Deploy behind HTTPS and a reverse proxy. Review content security policy for Next.js, centralized login throttling, monitoring, password recovery/MFA, database least privilege, retention and data protection before public use.
- Run permission, integration, and financial tests. Assess peak traffic, keyboard access, screen-reader behavior, and mobile browsers. These production checks are not complete just because a local build passes.

## Backups

Use daily encrypted database snapshots with at least 30-day retention plus managed PostgreSQL point-in-time recovery. Store copies in an independent account/location. Establish a four-hour recovery point objective and eight-hour recovery time objective with the owner.

For a self-managed database, use `pg_dump --format=custom --file=protune.backup "$DATABASE_URL"` from a protected operations host. Do not put passwords in command history; use a secret environment or protected pgpass. Treat backups as sensitive financial and personal data. Encrypt off-host copies. Do not back up into a public web folder.

Monthly, restore to an isolated database with `pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" protune.backup`. Verify migration state, branch counts, sales totals, payments, balances, cost snapshots and audit events. Document restore duration and any loss interval. Never test recovery by overwriting the live database.

## Current limitations

Local development PostgreSQL is a single-user evaluation environment. The local preview uses `connection_limit=3` to leave capacity for concurrent checks. Restart the existing `protune` Prisma dev instance if a prior session has stale connections; preserve its data directory. Expense revisions preserve effective-month history; closed months cannot be reopened in this release. Cash reconciliation is an explicit owner declaration, so reconcile journal entries against bank/cash records before closing. Tracked materials use actual weighted consumption costs; remaining service components are estimates. The application refreshes every 30 seconds. Refunds, stock returns, attendance correction, VAT returns, tax calculations, are pending. Password recovery, MFA and independent penetration testing remain outside this release. A local isolated recovery drill passes; production/offsite recovery must still be validated.

## Phase 4 CRM

Customer/vehicle links retain original invoice and job snapshots. Shared profile mutation locks assigned branches in sorted order and requires access to all of them; owner alone changes branch grants. Duplicate normalized mobile numbers and active plates are checked within assigned branches. Consent events are append-only, contact edits revoke the changed channel, and new profiles opt out. CRM is disabled by default. Existing linked job invoicing works while disabled. Customer exports expose commercial totals, never service costs or technician-only data; manager notes are omitted for cashiers. Historical attribution is explicit and does not rewrite financial snapshots.

## Marketing

Use Marketing to create/pause campaigns, issue promotion vouchers, register new-customer referrals, review customer loyalty, and inspect delivery/performance. Use checkout's voucher field and Check voucher after selecting a registered customer and services. The final save revalidates eligibility and applies the discount before VAT. Manual and voucher discounts cannot stack.

Live providers are unconfigured in the preview. Delivery is disabled; all sample vouchers are fictional and opted out. See [marketing setup](MARKETING.md) for private SMTP/WhatsApp credentials, templates, HTTPS webhooks and worker supervision. Keep the worker running beside the web process for automatic reactivation and delivery. Stop the worker or disable delivery to pause processing. Resolve uncertain sends only with provider evidence to prevent duplicate messages. SMTP acceptance does not guarantee inbox delivery.

## Phase 6 release tooling

See [DEPLOYMENT.md](DEPLOYMENT.md) for the concrete standalone/container release, encrypted backup tools, restore guard, four-hour scheduling templates and remaining production checks. Login throttling, nonce CSP, bounded requests, private cache headers and mobile/keyboard fixes are now implemented. No public release or production backup timer has been activated.
