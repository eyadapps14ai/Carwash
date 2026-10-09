# Production release and recovery

Phase 6 has been validated locally. No public deployment, production backup schedule, offsite storage, or live provider delivery has been configured. Use a staging environment first. Docker is unavailable on the evaluation machine, so the supplied container recipes still require a staging build and smoke test.

## Release

Use Node 22.12+ and pnpm 11.19.0. Provision a separate managed PostgreSQL database with TLS, restricted credentials, automated encrypted snapshots and point-in-time recovery. Configure an approved DNS hostname and HTTPS origin. Keep secrets outside source control; copy `.env.example` to `deployment/production.env`, restrict it to mode 0600, and supply the production database URL and exact HTTPS APP_ORIGIN. Do not copy evaluation data or run sample seed scripts.

From the release checkout, install with `pnpm install --frozen-lockfile`, then `pnpm db:generate`. Inject the protected production environment into the operations process. Apply migrations once using `pnpm db:migrate`; create the initial owner using `scripts/bootstrap.ts` only against the empty database. Remove SEED_OWNER_PASSWORD after bootstrap. Run `node --import tsx scripts/preflight.ts` with that environment. It rejects development databases, non-HTTPS origins, sample mode and retained bootstrap passwords.

Run unit tests, type checking, build and dependency audit before release. The build creates a standalone web server, copies static assets and removes traced dotenv files. `pnpm start` is the local standalone launcher; production containers inject secrets through the environment.

The supplied `deployment/compose.yaml` builds separate web and operations images, runs a supervised marketing worker, and exposes only Caddy on ports 80/443. Set PROTUNE_HOST to the approved DNS hostname, then use `docker compose -f deployment/compose.yaml build` and `docker compose -f deployment/compose.yaml up -d`. Apply database migrations before starting a new release. The proxy supplies HTTPS and limits request bodies. TRUST_PROXY is safe only when the web service cannot be reached directly and the trusted proxy controls forwarded headers.

Verify `/api/health`, owner sign-in, branch permissions, one reviewed test checkout, reports, keyboard/mobile behavior and worker logs in staging. Run fixture integration suites only against disposable staging data, never the live operating database. Keep marketing delivery disabled until SMTP settings, Meta templates, consent, webhooks and real recipient testing have been configured and reviewed. Provider setup is in [MARKETING.md](MARKETING.md).

Keep the previous application image and migration-compatible release. Take a verified backup before migrations. Roll back application code only if it remains compatible with the current schema; do not blindly reverse migrations or overwrite the live database. For destructive database recovery, restore separately, verify, and plan the cutover and any data reconciliation.

## Encrypted application backup

Generate a random 32-byte base64 BACKUP_KEY using a secret-management tool. Store the key independently from backups; losing it makes recovery impossible. Inject DATABASE_URL, BACKUP_KEY, BACKUP_DIR and BACKUP_RETENTION_DAYS into a protected operations environment. Use an unserved directory owned by the operations account. Files are created with mode 0600 and new directories with mode 0700.

`node --import tsx scripts/backup.ts create /secure/backups/manual.backup` captures all application models in a consistent transaction and encrypts them using authenticated AES-256-GCM. Decimal amounts retain their exact strings. `node --import tsx scripts/scheduled-backup.ts` creates timestamped files and retains 30 days by default (minimum seven). Copy encrypted backups to an independent account/location and alert on failed or stale backups. These application backups complement managed PostgreSQL recovery; they do not contain database roles, server configuration or point-in-time logs.

The supplied `deployment/backup.service` and `backup.timer` are Linux systemd templates for a four-hour schedule. Adjust executable/checkout paths, create the restricted operations account and `/etc/protune/backup.env`, and install/enable the timer on the production operations host. The templates are not installed or scheduled by this repository. Confirm the timer runs, storage is writable, copies reach offsite storage and failure alerts work. Agree recovery-point and recovery-time targets with the owner; a timer alone does not establish either target.

## Restore and prove recovery

Use the same schema-compatible release and a separate empty PostgreSQL target. Apply all migrations to the target first. Set RESTORE_DATABASE_URL to the distinct target and RESTORE_CONFIRM=EMPTY_ISOLATED_DATABASE, then run `node --import tsx scripts/backup.ts restore /secure/backups/manual.backup`. The tool rejects occupied targets, validates the model schema and authenticated ciphertext, restores transactionally in foreign-key order and verifies a data fingerprint. Sessions are revoked and marketing delivery is disabled after recovery.

Before cutover, verify branch/account counts, historical invoice amounts and VAT, payment totals, balances, inventory, quotes, audit records, exports and owner login. Record restore duration and the last recoverable timestamp. Reconfigure provider delivery only after reconciliation. Never use the live database as a restore-test target.

`pnpm test:recovery` performs a local drill in a temporary isolated schema, removes it afterwards and checks financial fingerprints, session revocation and disabled delivery. Repeat recovery in an independent staging database and from offsite storage before production, then monthly and after schema changes. Local recovery success does not prove production disaster recovery.

## Monitoring and boundaries

Monitor health failures, database connections/storage, worker failures, delivery backlog/unknown outcomes, backup age, certificate renewal and disk space. Keep logs free of passwords, access tokens, customer details and voucher/unsubscribe URLs. Review account access and patch dependencies regularly. Record incidents and recovery actions.

Local Phase 6 verification is documented in [VERIFICATION.md](VERIFICATION.md). The load check covers sample data and four concurrent reads; size and test the real production workload separately. Automated accessibility checks do not replace assistive-technology or broad mobile-browser testing. An independent penetration assessment, MFA and self-service password recovery remain outside this release. Refunds, stock returns and attendance corrections remain unavailable.

Deployment guidance follows [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting). Managed/database-native recovery should follow [PostgreSQL backup documentation](https://www.postgresql.org/docs/current/app-pgdump.html).
