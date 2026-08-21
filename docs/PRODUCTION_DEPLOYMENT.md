# UPT Plant Request Portal — Render deployment runbook

Target: **Render** — a Docker Web Service, managed **Render PostgreSQL**, and a
Render **Cron Job** for offer expiry and reminders. All three are declared in
[`render.yaml`](../render.yaml) at the repository root.

Everything that could be done in code is done. What remains needs a credential,
an authorization, or a live store. Work through the sections in order; each
states **what to do**, **who can do it**, and **exactly where**. Nothing below
asks you to write code.

> **Do not point this at the live UPT store yet.** Sections 1–6 stand up the
> infrastructure. Section 7 is the Shopify connection, and section 8 is the live
> verification — do those only when you are ready.

---

## Summary

| # | Blocker | Who | Where |
| --- | --- | --- | --- |
| 1 | Apply the Blueprint (creates all three resources) | **You** | Render Dashboard → New → Blueprint |
| 2 | Supply the six prompted secret values | **You** | Same flow, or each service's Environment tab |
| 3 | Confirm the database and web service came up | **You** | Render Dashboard |
| 4 | Confirm the cron job runs | **You** | Render Dashboard → upt-offer-maintenance |
| 5 | Resend API key + verified sending domain | **You** | Resend Dashboard |
| 6 | Enable database backups | **You** | Render Dashboard → upt-portal-db |
| 7 | Point the Shopify app at Render, install, approve scopes | **You** | Shopify Partner dashboard + store admin |
| 8 | Live verification of draft orders, Files, EXACT PLANTS, payment | You run it, I fix any failure | Storefront + Shopify admin |

**What I still need before I can finish anything:** the Render web service URL
(section 1). `shopify.app.toml` has a template placeholder for `application_url`
and Shopify's TOML does not support environment variables, so that value has to
be committed. Send me the hostname and I will commit it.

---

## 1. Apply the Blueprint — **account action**

**Where:** [Render Dashboard](https://dashboard.render.com) → **New** →
**Blueprint** → select this repository → choose this branch.

Render reads `render.yaml` and creates:

| Resource | Type | Plan | Notes |
| --- | --- | --- | --- |
| `upt-portal-db` | Render PostgreSQL 16 | `basic-256mb` | Private network only |
| `upt-plant-request-portal` | Web Service (Docker) | `starter` | Health check `/healthz` |
| `upt-offer-maintenance` | Cron Job (Node) | `starter` | Hourly, `0 * * * *` |

**Costs you are agreeing to.** All three are paid tiers, deliberately:

- The **free PostgreSQL tier is deleted after 30 days**, and this database is the
  only record of every plant request ever submitted. `render.yaml` pins
  `basic-256mb` to prevent that.
- Render **does not allow the free plan for cron jobs** at all.
- A **free web service spins down when idle**, and a cold start would make the
  storefront portal and Shopify webhooks time out.

Change the `plan:` values in `render.yaml` if you want larger instances. The
smallest paid tiers are ample for this workload — 16 small tables and a handful
of requests a day.

**Region.** `render.yaml` uses `oregon` for all three. Keep them in the same
region: the database is reachable on the private network only, and the web
service connects to it over that network.

---

## 2. Supply the prompted secrets — **account action**

Render prompts for every value marked `sync: false` during the Blueprint flow.
You can also set them later per service under **Environment**.

| Variable | Value | Where to get it |
| --- | --- | --- |
| `SHOPIFY_API_KEY` | Client ID | Shopify Partner dashboard → Apps → UPT Plant Request Portal → Configuration |
| `SHOPIFY_API_SECRET` | Client secret | Same page (`shopify app env show` prints both) |
| `SHOPIFY_APP_URL` | `https://upt-plant-request-portal.onrender.com` | Render gives you this after section 1. **No trailing slash.** |
| `CRON_SECRET` | `openssl rand -hex 32` | Generate it yourself |
| `RESEND_API_KEY` | Sending API key | Resend Dashboard (section 5) |
| `EMAIL_FROM` | `UPT Plant Requests <noreply@unsolicitedplanttalks.com>` | Must be on a domain verified in Resend |
| `UPT_ADMIN_EMAIL` | Your ops address | Fallback for admin notifications and customer data requests |

You do **not** need to set:

- `DATABASE_URL` — Render injects the database's connection string.
- `PORT`, `NODE_ENV`, `HOST` — set by `render.yaml` and the Dockerfile.
- `SCOPES` — the app uses the list in `app/lib/env.server.ts`, which a test keeps
  identical to `shopify.app.toml`.
- `CRON_SECRET` on the cron job — it reads the web service's value, so there is
  one value to rotate rather than two.

**Never set** `DEV_SHOP` or `ALLOW_CUSTOMER_DEMO_LOGIN` on Render. The app
refuses to boot with the latter, and both are development-only.

If a required value is missing or wrong, the deploy **fails immediately** with a
message naming the variable, rather than starting up in a degraded state. A
`SHOPIFY_APP_URL` on `http://`, a SQLite `DATABASE_URL`, `SHOPIFY_API_KEY=devkey`
and an incomplete `SCOPES` list are all rejected the same way.

---

## 3. Confirm the database and web service — **account action**

1. **Render → upt-portal-db** shows **Available**.
2. **Render → upt-plant-request-portal** → **Logs**. On first boot you should see
   the migrations applied, then the server start:

   ```
   Applying migration `20260820120000_init`
   All migrations have been successfully applied.
   [react-router-serve] http://localhost:3000 (http://0.0.0.0:3000)
   ```

   Migrations run at container start, so no manual step is needed — on this
   deploy or any future one.
3. The service reaches **Live** once `/healthz` returns 200. Check it yourself:

   ```bash
   curl https://upt-plant-request-portal.onrender.com/healthz
   # {"status":"ok"}
   ```

   `/healthz` returns 503 when the database is unreachable, which is what lets
   Render pull a broken instance out of rotation.

4. Sanity-check that the storefront portal is closed to unsigned requests:

   ```bash
   curl -o /dev/null -w '%{http_code}\n' \
     'https://upt-plant-request-portal.onrender.com/customer?logged_in_customer_id=1'
   # 404
   ```

   Customer requests are only served through Shopify's app proxy, which signs
   them. A 200 here would mean anyone could read customers' requests.

---

## 4. Confirm the cron job — **account action**

**Where:** Render Dashboard → **upt-offer-maintenance**.

Click **Trigger Run** and read the logs. A healthy run looks like:

```
POST https://upt-plant-request-portal.onrender.com/cron/offer-maintenance
  unsolicited-plant-talks.myshopify.com: 1 expired, 1 reminder(s) sent
Ran at 2026-08-21T03:00:00.000Z: 1 shop(s), 1 offer(s) expired, 1 reminder(s) sent.
```

Before the store is connected it will report `No shops with portal data`, which
is correct and exits 0.

**What it does.** Flips unpaid offers past their hold to **Expired**, and emails
a reminder for offers expiring within 24 hours. Nothing was driving the reminders
before, so they were never sent and offers only expired when someone happened to
open a page.

**Alerting.** The job exits non-zero on any failure — a wrong `CRON_SECRET`, an
unreachable service, or a per-shop error — so Render marks the run failed. Turn
on failure notifications under the cron job's **Settings**. A silently failing
cron job means offers stop expiring, which no one would notice.

Hourly is safe: a reminder is only ever sent once per request, and expiring an
already-expired offer is a no-op. Verified by running it twice in a row.

---

## 5. Resend — **account action**

**Where:** [Resend Dashboard](https://resend.com).

1. **Domains → Add Domain.** Add `unsolicitedplanttalks.com` (or whichever domain
   offer emails should come from), then add the DKIM and SPF records Resend shows
   you at your DNS provider. Wait for **Verified**.
2. **API Keys → Create API Key** with **Sending access**. That is
   `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on that verified domain.

**Why the domain step matters.** Resend rejects sends from an unverified domain
with a 403. Until it is verified, every message is stored in the `EmailMessage`
outbox with status `preview` and no customer is notified — including offer-ready
and checkout emails. The app logs a warning for every undelivered message in
production, and records a 403 with a pointer back to the Domains page.

---

## 6. Database backups — **account action**

**Where:** Render Dashboard → **upt-portal-db** → **Recovery** / **Backups**.

Confirm automatic backups are on and note the retention window. Plant requests
are the only record of what a customer asked for, and nothing else in the system
can reconstruct them.

---

## 7. Connect the Shopify app — **account action**

Do this when you are ready to point the app at the real store.

### 7a. Partner dashboard

**Where:** [Shopify Partner dashboard](https://partners.shopify.com) → **Apps** →
**UPT Plant Request Portal** → **Configuration**.

1. Set **App URL** to your Render URL.
2. Add these **Allowed redirection URLs**:
   - `https://upt-plant-request-portal.onrender.com/auth/callback`
   - `https://upt-plant-request-portal.onrender.com/auth/shopify/callback`
3. From a checkout of this branch, run `shopify app deploy`. That pushes the
   scopes, the webhook subscriptions (including the three mandatory privacy
   topics) and the app proxy configuration from `shopify.app.toml`.

`shopify.app.toml` still has the template placeholder
`application_url = "https://shopify.dev/apps/default-app-home"`. Send me the
Render hostname and I will commit the real value; otherwise `shopify app deploy`
prompts you to update it.

### 7b. Install and approve scopes

**Where:** the install/approval screen in the Shopify admin.

Install the app on the UPT store and approve the access request. Confirm the
screen lists product and publication permissions — without them the app cannot
create EXACT PLANTS listings or publish to Online Store and POS.

```
write_draft_orders, read_draft_orders, read_orders, read_customers,
write_files, read_files, read_products, write_products,
read_publications, write_publications
```

**If the app was installed before these scopes were added, you must approve
again** — an existing token does not gain scopes retroactively. Verify by opening
`/app` in the Shopify admin: it should load without redirecting to an
authorization screen.

### 7c. Store settings

1. **Shopify admin → Products.** Confirm a product exists with the handle
   `upgrade-to-fedex-priority-overnight-for-just-15-extra`. If the real handle
   differs, change it on the portal's **Settings** page. When the handle
   resolves, the FedEx upgrade is added to draft orders as that real variant at
   its Shopify price; when it does not, the app falls back to a custom line item
   priced from Settings — the customer is charged correctly, but the order does
   not reference the product and your product reporting will not see it.
2. **Portal admin → Settings.** Set the admin notification email.

---

## 8. Live verification — **run these, then send me any failure**

These need a real Admin API session, which cannot be reached from a build
environment. Every Shopify call has been validated against the live Admin
`2025-10` schema (`npm run validate-graphql`), which is as far as static
verification goes. Run each one and send me the error text if anything fails.

### 8a. Draft order

1. As a logged-in customer, open
   `https://YOUR-STORE/apps/plant-requests`.
2. Submit a request. In the portal admin, mark the plant Available, set a price
   and weight, and send the offer.
3. As the customer, **Accept** with the FedEx upgrade left checked.
4. **Shopify admin → Orders → Drafts:** one draft order, tagged
   `upt-plant-request` and with the request number (e.g. `REQ12`), the plant line
   at your price and weight, and a FedEx line.
5. Confirm the customer received the Shopify invoice email and its checkout link
   works.

Watch for whether the plant line requires shipping the way you expect. Custom
line items do not set `requiresShipping`, so Shopify's default applies — if
shipping rates do not appear at checkout, tell me and I will set it.

### 8b. Shopify Files

1. In the portal admin, open a **New** request and upload two exact-plant photos.
2. **Shopify admin → Content → Files:** both photos are listed.
3. Confirm the offer preview shows `cdn.shopify.com` URLs.

Uploads wait for Shopify to finish processing each file before reading its CDN
URL, which is what previously made them fail intermittently. There is **no**
local-disk fallback in production — a failed upload now shows an error on the
request detail page instead of silently storing a photo that would disappear on
the next deploy. If you see that error, send me the message.

### 8c. EXACT PLANTS, Online Store and POS

1. Offer an **Available** exact plant and have the customer **Reject** it.
2. **Confirm no product was created yet** — this is the rule that matters most.
3. Portal admin → **EXACT PLANTS** → review the item, edit the title or price,
   **Approve**.
4. **Shopify admin → Products:** exactly one product, in the **EXACT PLANTS**
   collection, with your edited values and the uploaded photos.
5. **Check the product's Sales channels:** **Online Store** and **Point of Sale**
   only, nothing else.
6. **Approve again.** No second product may appear, and your edits should land on
   the same product.

### 8d. Payment closes the request

1. Pay one of the draft-order invoices from 8a.
2. **Portal admin:** the request moves to **Closed** and the accepted plants show
   **Sold**.

The webhook matches on the draft order's tag, which Shopify copies to the paid
order, with the order note as a fallback. If a request stays **Pending** after
payment, send me the log line beginning `ORDERS_PAID for` — it records exactly
why an order did not match.

---

## After go-live

- **Watch the outbox.** `EmailMessage` rows with status `failed` mean a customer
  did not receive an offer or checkout link.
- **Watch the cron job.** A failed run means offers are not expiring and
  reminders are not going out.
- **Rotate `CRON_SECRET`** on the web service only; the cron job reads it from
  there.
- **Re-run `npm run validate-graphql`** before bumping the Shopify API version.
  It fetches the live schema and checks both the queries and the payloads.
- **Scaling up** is safe: sessions and all portal data live in PostgreSQL. Raise
  `numInstances` in `render.yaml`.
