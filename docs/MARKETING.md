# Phase 5 marketing operations

Delivery remains disabled in the supplied local preview. No real messages have been sent. WhatsApp Cloud API is implemented, and configurable SMTP supports the user's alternative email provider. Resend is an optional adapter. Provider credentials, verified sender/domain, approved templates, public HTTPS hosting and provider setup are required for live operation; these external prerequisites remain unconfigured.

## Campaign rules and reporting

Create campaigns as owner. Promotion codes are usable at checkout by a registered customer; issued vouchers are bound to one customer. Cashiers can apply authorized voucher discounts while manual discounts require management. Minimum spend refers to pre-discount subtotal; discounts apply only to eligible service prices. Fixed discounts cap at eligible prices. A free-service reward covers one lowest-priced eligible line. Discounts reduce taxable net revenue; original service cost snapshots remain intact. There is no stacking. Unique redemption constraints plus transaction serialization prevent simultaneous duplicate use. An unpaid cancellation voids its voucher permanently.

Dates use Dubai calendar days. A voucher expires after its configured lifetime or the campaign end, whichever is sooner. Campaigns must be active to issue or redeem. Reward rules, scopes, validity dates and limits cannot change after vouchers/referrals exist. Names, messaging details, active state and campaign budgets remain editable. New rules require a new campaign. Counts cap issued vouchers and redemptions; expired vouchers still count toward issuance limits. There is no merge, reissue, refund or voucher transfer workflow.

Loyalty visits count paid completed invoices once when an eligible service is present. Spending uses invoice net revenue apportioned by original eligible service selling prices, so invoice discounts are counted once and VAT is excluded. Qualification uses the configured campaign dates, including earlier linked invoices if the owner deliberately backdates the campaign. Reward evaluation spans all configured branches; management views show only authorized branch activity. Payment hooks reevaluate the customer after full settlement. Jobs qualify through their final invoice payment, never separately from the invoice.

Referrals must be registered before the new customer's first invoice. The first invoice must be paid, eligible, dated after referral registration, and meet the threshold. Self-referral is rejected. The referrer must remain active and assigned to the referral branch. Reactivation uses the most recent completed visit in campaign branches, including unpaid visits, to end an inactivity cycle. Repeated passes issue once per campaign and last-visit ID; a new visit starts a new cycle, subject to campaign limits.

Reports filter issuance, acceptance, delivery and redemption by their own event dates. Revenue uses the redemption invoice branch; delivery uses the issuing branch. Returning customers had an earlier completed visit in the selected authorized branch scope. Cancelled redemptions are excluded from revenue. Campaign contribution equals attributed net revenue minus historical direct costs minus the **full configured campaign budget**, allocated equally to campaign branches even when viewing a shorter date range. This excludes overhead and does not measure incremental lift. Enter actual campaign/delivery spending in the editable budget; no provider fee is assumed. CSV/Excel retain all columns; PDF uses a readable subset.

## Email provider setup

The default `EMAIL_PROVIDER=SMTP` supports verified provider SMTP submission. Set `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465 implicit TLS), `SMTP_USER`, and `SMTP_PASSWORD` or `SMTP_ACCESS_TOKEN`. Credentials are server-side. STARTTLS is required on 587; certificate verification remains enabled. OAuth token refresh must be managed by deployment/identity tooling. Configure a verified sender in owner delivery settings. Provider-specific sending limits and domain verification remain external prerequisites.

SMTP records `ACCEPTED` when the server accepts the recipient; it does not claim inbox delivery. Review provider logs for bounces/delivery evidence. SMTP `Message-ID` is stable per delivery, but SMTP offers no guaranteed duplicate-send prevention after a lost response; uncertain sends therefore remain `UNKNOWN` until an owner verifies they were never accepted.

Optional `EMAIL_PROVIDER=RESEND` uses `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. Its POST send uses a stable idempotency key. Configure webhook URL `/api/marketing/webhook?provider=email` for sent, delivered, failed, bounced, complained and suppressed events. Svix signatures, raw request bytes and timestamp tolerance are verified. Complaints/bounces opt out the profile and suppress pending messages. Acceptance and delivery are separate states.

Official references: [Nodemailer SMTP](https://nodemailer.com/smtp), [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).

## WhatsApp Business Cloud API setup

Configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and a supported `WHATSAPP_API_VERSION`. Secrets never enter frontend payloads or audit details. Use an approved marketing template configured per campaign and verify its approval in WhatsApp Manager before checking the campaign approval control. The body parameters are, in order: customer name, voucher code, Dubai expiry date, offer description, and private opt-out URL. The adapter sends template messages only; it never uses unofficial WhatsApp automation.

Configure public HTTPS webhook `/api/marketing/webhook?provider=whatsapp` with the verification token. Incoming POST requests require the correct `X-Hub-Signature-256` HMAC over raw bytes. Payloads must match the configured phone-number ID. Delivered/read events mark delivery; status events are deduplicated and older sent events cannot downgrade delivery. Verified inbound STOP, UNSUBSCRIBE or CANCEL disables both marketing channels for matching profiles.

Official reference: [Meta WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

## Enabling delivery and background processing

1. Set `PUBLIC_APP_ORIGIN` to your application's public HTTPS origin and configure providers privately.
2. Set `MARKETING_LIVE_ENABLED=true` only when live sending is intended.
3. Enable CRM and the required provider channels plus live delivery in owner delivery settings.
4. Run `pnpm marketing:worker` alongside the web process under a process supervisor. It evaluates campaigns and claims up to 20 queued messages per minute. `pnpm marketing:once` is suitable for an external scheduler; avoid overlapping unbounded jobs.
5. Confirm provider setup and template approval with controlled recipients in the deployed environment before real campaigns.

The outbox rechecks active customer, channel consent, matching destination, sample status, voucher validity and active campaign immediately before claiming each send. Contact changes revoke that channel's consent. Pausing a campaign blocks delivery; retry blocked messages after confirming configuration. Disabling CRM or live delivery stops claims and preserves queued records. Sample messages are suppressed even if sample contact values resemble real contacts.

Failures definitely rejected by a provider are `FAILED`. Network errors, lost responses and stale in-progress claims are `UNKNOWN` and are never retried automatically. An owner must confirm provider evidence that no message was accepted before resolving UNKNOWN, then retry separately. Review reasons are audited without storing secrets. Delivery network calls run outside database transactions. Provider webhooks may arrive before the acceptance write; if that occurs, replay the provider event after its ID is stored. Configure provider retry/replay according to the provider's tooling.

Private unsubscribe URLs require a confirmation POST; GET alone never changes consent, preventing mail-link prefetch from opting out customers. Confirmed opt-out creates immutable consent evidence and suppresses queued/blocked messages. Issued voucher pages reveal offer terms and status, not contact information. Voucher possession alone does not authorize another customer's redemption.

## Production boundary

Local mocked tests verify request construction and state handling, including SMTP TLS configuration, signed webhooks, replay deduplication and no-real-send behavior. They do not verify real provider account eligibility, deliverability, approved-template status, SMTP domain/DNS configuration, token renewal, worker supervision or production HTTPS. Phase 6 covers production security, performance, backups and deployment validation. Marketing transaction serialization currently prioritizes correctness; scalability needs load testing before deployment.
