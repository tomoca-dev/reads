# TOMOCA Reads — Vercel + Supabase + Stripe

This release is the Vercel production version of TOMOCA Reads. It no longer uses SQLite, Cloudflare D1, Vinext, or a persistent self-hosted Node server.

## Production architecture

```
GitHub
  ↓
Vercel / Next.js
  ├── public reader + admin UI
  ├── route handlers
  ├── daily maintenance cron
  └── Stripe webhook endpoint
        ↓                    ↓
Supabase PostgreSQL       Stripe
```

## Access model

- TOMOCA/business pays the service subscription through Stripe.
- Café customers do not pay and do not need an account.
- Each branch gets one QR token per Addis Ababa calendar day.
- The same daily QR can be scanned by any number of customers while it is valid.
- Every successful scan creates a separate 30-minute reader session.
- At midnight EAT, the previous day's QR becomes invalid. The open admin/counter display checks periodically and replaces it automatically; otherwise the next admin request creates the new day's QR.
- New QR scans are accepted only when the TOMOCA Stripe subscription is `active` or `trialing`.
- An already-created reader session remains valid until its own 30-minute expiry.

## Included branches

- Historical
- Sip
- Abrehot

## 1. Create the Supabase project

Create a Supabase project. The free plan is suitable for development/pilot use.

Open **Supabase Dashboard → SQL Editor**, run these migrations in order:

```
supabase/migrations/001_tomoca_reads.sql
supabase/migrations/002_multi_admin_invitations.sql
```

Existing deployments that already ran migration 001 only need to run migration 002.

The migration creates:

- `organizations`
- `admin_accounts`
- `admin_sessions`
- `admin_login_attempts`
- `sessions`
- `codes`
- `editions`
- `registrations`
- `daily_branch_metrics`
- `story_overrides`
- `system_locks`
- `admin_invitations`
- atomic SQL functions for metrics, login throttling, cleanup, and refresh locking

RLS is enabled and no anonymous/authenticated database policies are created. The browser never receives the Supabase secret key; database access occurs only through server-side Next.js route handlers.

From **Supabase → Project Settings → API**, copy:

- Project URL → `SUPABASE_URL`
- server secret key (`sb_secret_...`) → `SUPABASE_SECRET_KEY`

Never put the Supabase secret key in a `NEXT_PUBLIC_*` variable. The runtime also accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` temporarily for older projects, but the new secret key is preferred.

## 2. Create the Stripe subscription product

In Stripe Dashboard:

1. Create a product such as **TOMOCA Reads**.
2. Add a recurring monthly price of **$25 USD/month**.
3. Copy its `price_...` ID to `STRIPE_PRICE_ID`.
4. Copy the Stripe secret API key to `STRIPE_SECRET_KEY`.

After the Vercel deployment exists, add a Stripe webhook endpoint:

```
https://YOUR-DOMAIN/api/stripe/webhook
```

Subscribe the endpoint to at least:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Copy the webhook signing secret (`whsec_...`) to `STRIPE_WEBHOOK_SECRET` in Vercel and redeploy.

The app verifies the webhook signature before changing billing state. The admin dashboard uses this database-backed state to decide whether daily QR access is enabled.

## 3. Generate application secrets

Generate three different random values:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Use them for:

- `ADMIN_SETUP_TOKEN`
- `RATE_LIMIT_SECRET`
- `CRON_SECRET`

Do not reuse one secret for multiple purposes.

## 4. Local environment

Copy the template:

```bash
cp .env.example .env.local
```

Fill in all required values. For local development use:

```
SITE_URL=http://localhost:3000
```

Then install and run:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/admin`.

If there is no administrator account yet, the admin page displays the initial activation form. Enter the `ADMIN_SETUP_TOKEN`, administrator email, and a password of at least 14 characters. The setup token creates only the first administrator. Additional administrators are invited from the authenticated admin dashboard with one-time 48-hour activation links.


## Additional administrators

After the first administrator signs in, open **Administrator access** in `/admin`. Enter the new administrator email and choose **Create administrator invitation**. The application returns a one-time link such as:

```
https://YOUR-DOMAIN/admin/activate?token=...
```

Send that link directly to the intended administrator. The raw token is never stored in Supabase; only its SHA-256 digest is stored. The link expires after 48 hours and is marked used atomically when the administrator chooses a password. Reissuing an invitation invalidates the previous pending link for that email.

If the email already exists in `admin_accounts`, consuming the invitation securely resets that administrator's password and invalidates their existing admin sessions. This is useful when migrating a manually-created second administrator.

All administrators sign in at `/admin` using their own email and password. Login lookup is by normalized email rather than the legacy hard-coded `primary` account.

## 5. GitHub

Create a private GitHub repository and push the extracted project, not the ZIP file.

```bash
git init
git add .
git commit -m "TOMOCA Reads Vercel Supabase release"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/tomoca-reads.git
git push -u origin main
```

`.env*` files are ignored except `.env.example`. Never commit real secrets.

## 6. Vercel

Import the GitHub repository into Vercel. Framework detection should select **Next.js**.

Set these environment variables in **Vercel → Project → Settings → Environment Variables**:

```
SITE_URL
SUPABASE_URL
SUPABASE_SECRET_KEY
ADMIN_SETUP_TOKEN
RATE_LIMIT_SECRET
CRON_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID
```

Optional:

```
RSS_MAX_BYTES=2097152
REGISTRATION_RETENTION_DAYS=365
OVERRIDE_RETENTION_DAYS=90
```

Deploy. Test first on the Vercel domain, then set `SITE_URL` to the final custom HTTPS domain and redeploy.

## 7. Daily QR behavior

The admin dashboard requests `/api/qr?branch=...`.

For a branch on a given Addis Ababa date, the backend:

1. verifies the Stripe subscription is active/trialing;
2. looks for that branch's existing daily token;
3. returns the existing token if it exists;
4. otherwise creates a cryptographically random 256-bit token;
5. sets its expiry to the next midnight in Addis Ababa.

The QR therefore stays stable for the branch throughout the day. It is not regenerated every 30 minutes. While the admin/counter display remains open it re-checks the daily token every minute, so an overnight display rotates to the new day's QR automatically.

Example:

```
Historical QR for 20 Oct
  ├─ Customer A scans 09:00 → session until 09:30
  ├─ Customer B scans 12:20 → session until 12:50
  ├─ Customer C scans 17:42 → session until 18:12
  └─ Customer D scans 22:15 → session until 22:45

At midnight EAT the 20 Oct QR expires.
21 Oct receives a different token.
```

The daily QR is still a bearer token. A photograph of the valid day's QR can be shared until midnight. This release does not claim GPS/Wi-Fi/proximity verification.

## 8. Stripe billing behavior

The admin can start the $25/month subscription from the dashboard. The server creates a Stripe Checkout Session. Stripe—not TOMOCA Reads—collects the card details.

Signed Stripe webhooks update the single TOMOCA organization record in Supabase. Customer QR scans are allowed only when the subscription is `active` or `trialing`.

The admin can open the Stripe Customer Portal from the dashboard to manage or cancel the subscription. Configure the Customer Portal in Stripe Dashboard before using that button.

Customers never see Stripe and never pay to read.

## 9. News refresh

The current edition is stored in Supabase as JSONB. Readers normally receive the saved edition immediately. If it is stale, Next.js schedules a background refresh after the response. A daily Vercel cron also runs:

```
GET /api/cron/maintenance
```

at 05:00 UTC (08:00 EAT), with `Authorization: Bearer $CRON_SECRET` supplied by Vercel Cron.

A database lock prevents multiple Vercel instances from refreshing the RSS set at the same time.

The RSS collector enforces HTTPS destinations, publisher-host allowlists, manual redirect validation, redirect limits, response-size limits, and timeouts.

## 10. Data lifecycle

Temporary data is separate from permanent aggregate metrics.

Daily maintenance removes:

- expired reader sessions
- expired daily QR codes
- expired admin sessions
- expired login-rate records
- phone registrations older than the configured retention period
- old editorial overrides

`daily_branch_metrics` remains after reader session deletion, preserving branch totals without retaining reader identifiers.

Administrators can also delete individual phone registrations from the dashboard.

## 11. Security characteristics

- server-only Supabase secret key
- RLS enabled with no browser database policies
- 600,000-iteration PBKDF2-HMAC-SHA256 admin password hashes
- hashed admin-session identifiers
- hashed reader-session identifiers
- 256-bit random session and QR tokens
- IP/email login throttling using hashed identifiers
- strict origin checking on state-changing browser requests
- signed Stripe webhook verification
- secure/HttpOnly/SameSite cookies in production
- CSP, HSTS, MIME, frame, referrer, and permissions headers
- bounded and host-validated RSS requests

## 12. Health endpoints

```
/healthz
/readyz
```

`/healthz` confirms the Vercel application is running. `/readyz` also checks Supabase connectivity.

## Testing before production

Run:

```bash
pnpm install
node tests/static.mjs
pnpm build
```

After the first successful `pnpm install`, commit the generated `pnpm-lock.yaml` to your private GitHub repository. Future deployments can then use the lockfile for reproducible installs.

Then verify manually:

1. `/readyz` reports OK.
2. activate the first admin account.
3. login/logout works.
4. Stripe test Checkout works.
5. the signed test webhook sets billing to active/trialing.
6. each branch shows one stable QR for the day.
7. two browsers scanning the same QR receive independent 30-minute sessions.
8. a daily QR no longer works after its EAT day ends.
9. an inactive subscription blocks new QR scans.
10. news refresh/editorial overrides work.
11. phone registration and deletion work.
12. no secret is present in the browser bundle or GitHub repository.

## Supabase backups

This application does not pretend that local Vercel files are backups. Database backup/PITR availability depends on your Supabase plan. For a serious production launch, enable an appropriate Supabase backup plan or maintain tested external `pg_dump` backups.
