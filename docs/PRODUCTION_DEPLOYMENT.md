# UPT Plant Request Portal — production deployment runbook

Everything that could be done in code is done. What remains needs a credential,
an authorization, a hosting decision, or a live store — none of which can be
produced from a build environment.

Work through the sections in order. Each blocker states **what to do**, **who can
do it**, and **exactly where**. Nothing below asks you to write code.

---

## Summary

| # | Blocker | Who | Where |
| --- | --- | --- | --- |
| 1 | Choose and provision a PostgreSQL database | **You** | Your hosting provider's dashboard |
| 2 | Choose and provision a host for the app | **You** | Your hosting provider's dashboard |
| 3 | Point the Shopify app at that host and deploy the config | **You** | Shopify Partner dashboard + `shopify app deploy` |
| 4 | Install the app on the UPT store and approve the scopes | **You** | Shopify admin install screen |
| 5 | Create the Resend API key and verify the sending domain | **You** | Resend dashboard |
| 6 | Generate `CRON_SECRET` and schedule the maintenance call | **You** | Wherever you host cron |
| 7 | Confirm the FedEx upgrade product handle | **You** | Shopify admin → Products |
| 8 | Set the admin notification email | **You** | Portal admin → Settings |
| 9 | Live draft-order verification | You run it, I can fix any failure | Storefront + Shopify admin |
| 10 | Live Shopify Files verification | You run it, I can fix any failure | Portal admin → request detail |
| 11 | Live EXACT PLANTS + Online Store/POS verification | You run it, I can fix any failure | Storefront + Shopify admin |
| 12 | Live `orders/paid` verification | You run it, I can fix any failure | Shopify admin → Orders |

Items 1–8 are account actions I cannot perform. Items 9–12 need a live store; run
them and send me any error and I will fix the code.

---

## 1. PostgreSQL database — **decision + credential needed from you**

**Why this is a blocker.** SQLite was writing to a file inside the container.
Every restart or redeploy lost every plant request, and a second instance was
impossible. The app now refuses to start in production on a SQLite URL.

**What to do.** Provision a managed PostgreSQL 16 database and copy its
connection string. Any of these work; pick whichever matches where you host the
app (section 2):

| Provider | Where |
| --- | --- |
| Fly.io Postgres | `fly postgres create`, or Fly dashboard → Postgres |
| Railway | Railway dashboard → New → Database → PostgreSQL |
| Render | Render dashboard → New → PostgreSQL |
| Neon | Neon console → New Project |
| Supabase | Supabase dashboard → New project → Settings → Database |
| Heroku | Heroku dashboard → Resources → Heroku Postgres |

**What I need from you.** The connection string, set as the `DATABASE_URL`
environment variable on the app host:

```
postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&sslmode=require
```

Most managed providers require `sslmode=require`. Nothing else is needed — the
container applies the migrations itself on first boot.

**Sizing.** The smallest tier any of these offer is ample. The schema is 16 small
tables and the portal handles a few requests a day.

**Already verified:** the migrations apply to an empty PostgreSQL 16 database and
the full test suite passes against PostgreSQL as well as SQLite.

---

## 2. Application host — **decision needed from you**

**What to do.** Pick a host that can run a Docker container with a persistent
public HTTPS URL. The committed `Dockerfile` is production-ready and was built
and booted end to end; it needs no changes.

Requirements:

- Runs a container image, or builds from the `Dockerfile`
- Gives a stable HTTPS hostname (Shopify rejects `http://` app URLs)
- Lets you set environment variables / secrets
- One instance is enough; more than one is safe now that the database is shared

Fly.io, Railway, Render and Heroku all satisfy this. **Do not** use a
serverless/edge platform that recycles instances aggressively — Shopify OAuth
sessions live in PostgreSQL so that is safe, but the platform must support a
long-running Node process.

**Environment variables to set on the host.** `.env.example` is the full
reference. Required:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | from section 1 |
| `SHOPIFY_API_KEY` | from section 3 |
| `SHOPIFY_API_SECRET` | from section 3 |
| `SHOPIFY_APP_URL` | the host's public HTTPS URL, no trailing slash |
| `CRON_SECRET` | from section 6 |
| `RESEND_API_KEY` | from section 5 |
| `EMAIL_FROM` | from section 5 |

Leave `SCOPES` unset — the app uses the list in `app/lib/env.server.ts`, which a
test keeps identical to `shopify.app.toml`. Never set `DEV_SHOP` or
`ALLOW_CUSTOMER_DEMO_LOGIN` in production; the app refuses to boot with the
latter.

The app refuses to start if any required value is missing or obviously wrong, so
a misconfigured deploy fails immediately and loudly rather than silently falling
back to demo behaviour. Health check endpoint: `GET /healthz`.

---

## 3. Shopify app credentials and URLs — **account action needed from you**

**Where:** [Shopify Partner dashboard](https://partners.shopify.com) → **Apps** →
**UPT Plant Request Portal** → **Configuration**.

**What to do.**

1. Copy the **Client ID** into `SHOPIFY_API_KEY` and the **Client secret** into
   `SHOPIFY_API_SECRET` on the app host. (`shopify app env show` prints both.)
2. Set **App URL** to your `SHOPIFY_APP_URL`.
3. Add these **Allowed redirection URLs**:
   - `https://YOUR-APP-URL/auth/callback`
   - `https://YOUR-APP-URL/auth/shopify/callback`
4. From a checkout of this branch, run `shopify app deploy`. That pushes the
   scopes, webhook subscriptions (including the three compliance topics) and the
   app proxy configuration from `shopify.app.toml`.

`shopify.app.toml` still has the template placeholder
`application_url = "https://shopify.dev/apps/default-app-home"`. Shopify's TOML
does not support environment variables, so this has to be your real URL. Tell me
the hostname and I will commit it; otherwise `shopify app deploy` will prompt you
to update it.

**Why I cannot do this.** It requires a Shopify Partner login.

---

## 4. Install on the UPT store and approve scopes — **account action needed from you**

**Where:** the install/approval screen the Shopify admin shows you.

**What to do.** Install (or reinstall) the app on the UPT store and approve the
access request. Confirm the approval screen lists product and publication
permissions — the app cannot create EXACT PLANTS listings or publish to Online
Store and POS without them.

The full scope list is:

```
write_draft_orders, read_draft_orders, read_orders, read_customers,
write_files, read_files, read_products, write_products,
read_publications, write_publications
```

**If the app was installed before these scopes were added, you must approve
again** — an existing token does not gain scopes retroactively. Verify
afterwards by opening `/app` in the Shopify admin: it should load without
redirecting to an authorization screen.

**Why I cannot do this.** Only a store owner or staff member with the right
permissions can grant an app access to a store.

---

## 5. Resend — **account action needed from you**

**Where:** [Resend dashboard](https://resend.com).

**What to do.**

1. **Domains → Add Domain.** Add `unsolicitedplanttalks.com` (or whichever domain
   you want offer emails to come from) and add the DKIM and SPF DNS records
   Resend shows you at your DNS provider. Wait for the domain to show
   **Verified**.
2. **API Keys → Create API Key** with **Sending access**. Copy it into
   `RESEND_API_KEY` on the app host.
3. Set `EMAIL_FROM` to an address on that verified domain, for example
   `UPT Plant Requests <noreply@unsolicitedplanttalks.com>`.

**Why the domain step matters.** Resend rejects sends from an unverified domain
with a 403. Until then every message is stored in the `EmailMessage` outbox with
status `preview` and nothing reaches the customer — including offer-ready and
checkout emails. The app now logs a warning for every undelivered message in
production, and a 403 is recorded with a pointer to the Domains page.

**Why I cannot do this.** It needs a Resend account and DNS access.

---

## 6. `CRON_SECRET` and the scheduler — **account action needed from you**

**What to do.**

1. Generate a secret: `openssl rand -hex 32`.
2. Set it as `CRON_SECRET` on the app host.
3. Schedule an hourly authenticated request:

```bash
curl -fsS -X POST https://YOUR-APP-URL/cron/offer-maintenance \
  -H "Authorization: Bearer $CRON_SECRET"
```

Any scheduler works — GitHub Actions `schedule`, Fly.io Machines cron, Railway
cron, Render Cron Job, Heroku Scheduler, or a plain crontab. Hourly is
recommended; the endpoint is safe to call more often because a reminder is only
ever sent once per request.

**What it does.** Flips unpaid offers past their hold to **Expired**, and emails
an expiration reminder for offers expiring within 24 hours. Nothing was calling
the reminder function before, so reminders were never sent and offers only
expired when someone happened to open a page.

**Verify it.** The response is JSON, and a non-2xx status means the run failed:

```json
{"ranAt":"2026-08-21T00:00:00.000Z","shops":[{"shop":"...","expired":1,"remindersSent":1}]}
```

The route returns 404 until `CRON_SECRET` is set, so it cannot be reached on an
unconfigured deploy.

**Why I cannot do this.** The secret has to be generated by you and stored where
your scheduler can read it.

---

## 7. FedEx upgrade product handle — **store check needed from you**

**Where:** Shopify admin → **Products**, then the portal's **Settings** page.

**What to do.** Confirm a product exists with the handle the portal expects:

```
upgrade-to-fedex-priority-overnight-for-just-15-extra
```

If the real handle differs, change it on the portal's Settings page.

**Why it matters.** When the handle resolves, the FedEx upgrade is added to the
draft order as that real product variant at its real Shopify price. When it does
not, the app falls back to a custom line item priced from Settings — the customer
is still charged correctly, but the order does not reference the product and your
product reporting will not see it.

---

## 8. Admin notification email — **store check needed from you**

**Where:** portal admin → **Settings** → admin notification email.

**What to do.** Set the address that should receive new-request notifications.
This address also receives the export when a customer files a data request under
`customers/data_request`; if it is blank, that export cannot be delivered and the
app only logs a warning. `UPT_ADMIN_EMAIL` works as a fallback.

---

## 9–12. Live verification — **run these on the store, then send me any failure**

These need a real Admin API session against the UPT store, which cannot be
reached from a build environment. Every call has been validated against the live
Shopify Admin `2025-10` schema (`npm run validate-graphql`), which is as far as
static verification goes. Run each one and send me the error text if anything
fails.

### 9. Draft order

1. As a logged-in customer on the storefront, open
   `https://YOUR-STORE/apps/plant-requests`.
2. Submit a request; in the portal admin mark the plant Available, set a price
   and weight, and send the offer.
3. As the customer, **Accept** with the FedEx upgrade left checked.
4. **Check in Shopify admin → Orders → Drafts:** one draft order exists, tagged
   `upt-plant-request` and with the request number (for example `REQ12`), with the
   plant line at your price and weight and a FedEx line.
5. Confirm the customer received the Shopify invoice email and that its checkout
   link works.

Watch for: `Money` or currency errors on the plant line, and whether the plant
line requires shipping the way you expect. Custom line items do not set
`requiresShipping` explicitly, so Shopify's default applies — if shipping rates
do not appear at checkout, tell me and I will set it.

### 10. Shopify Files

1. In the portal admin, open a **New** request and upload two exact-plant photos.
2. **Check in Shopify admin → Content → Files:** both photos are listed.
3. Confirm the offer preview shows `cdn.shopify.com` URLs, not `/uploads/...`.

Uploads now wait for Shopify to finish processing each file before reading its
CDN URL, which is what previously made them fall back to local disk. If a photo
still lands on `/uploads/...`, send me the admin log line.

### 11. EXACT PLANTS listing, Online Store and POS

1. Offer an **Available** exact plant and have the customer **Reject** it.
2. **Confirm no product was created yet** — this is the rule that matters most.
3. In the portal admin, open **EXACT PLANTS**, review the item, edit the title or
   price, and **Approve**.
4. **Check in Shopify admin → Products:** exactly one product, in the **EXACT
   PLANTS** collection, with your edited values and the uploaded photos.
5. **Check the product's Sales channels:** **Online Store** and **Point of Sale**
   only, nothing else.
6. **Approve again.** No second product may appear; your edits should be applied
   to the same product.

### 12. Payment closes the request

1. Pay one of the draft-order invoices from step 9.
2. **Check the portal admin:** the request moves to **Closed** and the accepted
   plants show **Sold**.

The webhook matches on the draft order's tag, which Shopify copies to the paid
order, with the order note as a fallback. If a request stays **Pending** after
payment, send me the app log line beginning `ORDERS_PAID for` — it now records
exactly why an order did not match.

---

## After go-live

- **Back up the database.** Enable your provider's automated backups. Plant
  requests are the only record of what a customer asked for.
- **Watch the outbox.** `EmailMessage` rows with status `failed` mean a customer
  did not receive an offer or checkout link.
- **Alert on the cron.** A non-2xx from `/cron/offer-maintenance` means offers
  are not expiring and reminders are not going out.
- **Re-run `npm run validate-graphql`** before bumping the Shopify API version.
  It fetches the live schema and checks both the queries and the payloads.
