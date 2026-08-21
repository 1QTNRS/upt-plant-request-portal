# UPT Plant Request Portal — Cloud Agent Handoff

Durable status for the next Cloud Agent. Do **not** rebuild this app. Continue from the existing React Router + Prisma implementation.

- Repo: `https://github.com/1qtnrs/upt-plant-request-portal`
- PR #22 (Prisma persistence + declined EXACT PLANTS listings) is **merged to `main`**.
- Working branch: `cursor/production-readiness-blockers-7617` (base: `main`) — production readiness.
- Pull request: https://github.com/1qtnrs/upt-plant-request-portal/pull/24

**Read [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) first.** Every remaining
blocker is an account action, a hosting decision, or a live-store verification.
There is no known application-code work left. Do not start new work without
checking that runbook — several items look like code gaps but are credentials.

---

## What is fully implemented

The plant-request workflow is persisted in Prisma (SQLite by default) and wired through the current admin and customer UI. This is no longer a `localStorage` prototype for the active routes.

Implemented end-to-end in app code:

- Customer request submit (plant name required, notes optional, no quantity UI, quantity stored as 1, **no Budget field**)
- Request numbers: sequential `REQ1`, `REQ2`, … `REQ2178` (no year prefix, no zero-padding)
- Private customer request list (identity-scoped)
- Admin dashboard with search (customer name, email, request number, plant/offered name)
- Admin request detail: Available / Not Available, offered name, price, weight, customer-facing notes, multi-photo upload
- Offer send with 3/5/7 day hold; offer snapshot freezes name, price, weight, photos, notes, availability
- Customer offer: Accept / Reject for Available items only; Not Available cannot be accepted or rejected
- FedEx Priority Overnight upgrade checked by default; settings-driven removal warning; excluded from plant analytics
- Draft-order creation for **accepted plants only** (GraphQL when an Admin API client exists; demo fallback invoice URL otherwise)
- `orders/paid` webhook → request **Closed**, accepted items **Sold**
- Unpaid offer expiry → **Expired** (checked when loading requests / analytics)
- Declined exact-plant listing review: customer reject is saved **without** publishing; admin must review and approve before any Shopify product is created
- After admin approval: one Shopify product per declined item, EXACT PLANTS collection, Online Store + POS only, idempotent retries, **Listed** status + product link
- Analytics from the database (FedEx excluded from plant revenue/counts)
- Settings: FedEx warning text and admin notification email
- Email outbox rows for request received, admin new-request, offer ready, confirmation, checkout, expiration reminder

Demo seed (`ensureShopSeeded`) creates `REQ1`–`REQ7` sample requests plus `REQ8` (declined Thai Constellation + Not Available String of Pearls) for listing review.

---

## Mock / prototype versus production-ready

| Area | Status |
| --- | --- |
| Prisma request/offer/response/listing persistence | Production-ready. `DATABASE_URL` selects the provider; PostgreSQL schema + migration committed and verified |
| Admin UI (dashboard, request detail, analytics, settings, EXACT PLANTS) | Production-ready in code; local Cloud VM uses `SHOPIFY_API_KEY=devkey` bypass |
| Customer request + offer UI | Production-ready in code |
| Request numbering `REQn` | Production-ready in code |
| Shopify Admin OAuth / embedded admin | Implemented via Shopify app template; **not usable in the headless Cloud VM** |
| Customer authentication | App proxy requests are HMAC-verified and the customer's real name/email is read from the Admin API. Unsigned requests are refused in production. Customer Account OAuth is still not implemented and is not needed for the app-proxy flow |
| Draft orders | Code complete and schema-validated; the customer path now gets an offline Admin client. **Not yet run against a live store** |
| Shopify Files photo upload | Code complete; waits for `fileStatus: READY`. **Not yet run against a live store** |
| EXACT PLANTS product create + collection + Online Store/POS publish | Code complete and schema-validated. **Not yet run against a live store** |
| Email delivery | Outbox + Resend client with retries and error reporting; without `RESEND_API_KEY` messages stay `preview` and production logs a warning per message |
| Expiration reminders | Scheduled via `POST /cron/offer-maintenance`, guarded by `CRON_SECRET`. Verified end to end |
| Privacy/compliance webhooks | All three mandatory topics subscribed and implemented |
| Deployment | **Render** is the chosen target: `render.yaml` declares the PostgreSQL database, the Docker web service and the offer-maintenance cron job. Multi-stage `Dockerfile` built and booted against PostgreSQL; `/healthz` probe; CI runs the suite against both providers |
| Unused `app/lib/sample-*.ts`, `item-*.ts`, `customer-*-submissions.ts` localStorage modules | Leftover prototype. **Active routes do not import them.** Do not resurrect them as the source of truth |

---

## Database / schema architecture

Prisma cannot take its datasource provider from an environment variable, so there
are two schemas and `DATABASE_URL` decides which one is used:

| Path | Provider | Used by |
| --- | --- | --- |
| `prisma/schema.prisma` | SQLite | Local development (`DATABASE_URL` unset → `file:dev.sqlite`) |
| `prisma/postgres/schema.prisma` | PostgreSQL | Production. **Generated** from the SQLite schema |

`prisma/postgres/schema.prisma` is generated by `npm run prisma:sync-schema`.
**Edit `prisma/schema.prisma` and regenerate** — `npm run prisma:check-schema`
(run in CI) fails when the two drift apart.

`scripts/prisma.mjs` wraps the Prisma CLI and picks the schema from the
`DATABASE_URL` scheme, so `npm run setup`, `prisma:generate`, `prisma:migrate` and
`prisma db seed` all work for either provider with no extra flags. It refuses a
missing or SQLite URL when `NODE_ENV=production`.

SQLite migrations (`prisma/migrations/`):

1. `20240530213853_create_session_table` — Shopify `Session`
2. `20260820061236_plant_request_portal` — portal tables
3. `20260820073000_exact_plant_listings` — `ExactPlantListing`

PostgreSQL migrations (`prisma/postgres/migrations/`) are a single squashed
`20260820120000_init`, since production starts from an empty database.

Shop-scoped models (multi-tenant by `shop` string):

- `ShopSettings` — FedEx warning, product handle/variant, upgrade price/label, admin email
- `RequestNumberSequence` — still keyed by `(shop, year)`; live numbering uses `year = 0` (`GLOBAL_REQUEST_SEQUENCE_YEAR`) for a shop-wide counter
- `CustomerProfile` — unique `(shop, email)`
- `PlantRequest` — statuses stored as `New` / `Pending` / `Closed` / `Expired`
- `RequestItem` — plant line; `budget` column **kept but unused** in the active workflow (do not destructive-migrate solely to drop it)
- `PhotoReference` — ordered photos on a request item
- `Offer` + `OfferItem` — immutable offer snapshot
- `CustomerResponse` + `ResponseItem` — customer choices (`accept` / `reject` / `unavailable`)
- `DraftOrderReference` / `ShopifyOrderReference`
- `StatusEvent` / `EmailMessage`
- `ExactPlantListing` — unique `requestItemId`; stores approved title/price/weight/photos, Shopify product GID/handle, `listed` \| `failed`, `lastError`

Item statuses: `Requested` | `Sourced` | `Offered` | `Sold` | `Unavailable` | `Listed`.

Commands: `npm run setup`, `npm run prisma:generate`, `npm run prisma:migrate`,
`npm run prisma:validate` (both schemas), `npm run prisma:sync-schema`,
`npm run prisma:check-schema`, `node scripts/prisma.mjs db seed`.

---

## Shopify integrations implemented (in code)

- Admin OAuth via `@shopify/shopify-app-react-router` (`app/shopify.server.ts`, API version October 2025 / `2025-10`)
- App proxy `/apps/plant-requests` → `/customer`, **HMAC-verified** (`app/lib/app-proxy.ts`)
- Offline Admin client for the app-proxy customer path (`app/lib/offline-admin.server.ts`). Goes through `unauthenticated.admin(shop)`, which calls `ensureValidOfflineSession` and therefore refreshes the token under the `expiringOfflineAccessTokens` future flag — the customer draft-order path does not break when the offline token expires.
- Customer name/email resolved from the Admin API and cached in `CustomerProfile` (`app/lib/customer-identity.server.ts`)
- Request ownership decided by `identityOwnsRequest` (`app/lib/customer-identity.ts`, pure). A request already claimed by a Shopify account id is **never** reachable by email, so changing an account email cannot reach a stranger's request
- Draft order create + invoice send (`createDraftOrderForRequest` in `app/lib/shopify-ops.server.ts`), custom lines priced with `originalUnitPriceWithCurrency`
- FedEx upgrade product lookup via `productByIdentifier`
- Shopify Files staged upload + `fileCreate`, polling `fileStatus` until `READY` (`uploadPlantPhoto`)
- `orders/paid` webhook (`app/routes/webhooks.orders.paid.tsx`) matches `REQ…` or legacy `UPT-REQ-…` tags/notes, ignores redeliveries for an already-paid request
- Mandatory privacy webhooks: `customers/data_request`, `customers/redact`, `shop/redact` (`app/lib/compliance.server.ts`)
- Draft orders are idempotent twice over: a recorded `DraftOrderReference` short-circuits, and `draftOrderIdempotencyTag` finds a draft order Shopify already created when a previous reply was lost. Without it a retry bills the customer twice
- Outbound email is deduplicated on `EmailMessage.idempotencyKey` (`@@unique([shop, idempotencyKey])`), so a retry or a double form submit cannot send the same message twice
- EXACT PLANTS: find/create collection titled `EXACT PLANTS`, `productCreate` with media, variant price + weight (lb), `collectionAddProducts`, `publishablePublish` to Online Store and Point of Sale only (paginating all publications)
- Idempotency tag `upt-declined-item:{requestItemId}` so retries do not create duplicate products; a retry updates the existing product instead

### Verifying Shopify calls without a store

`npm run validate-graphql` fetches the live Admin schema for the version in
`app/shopify.server.ts` and validates every `#graphql` document **and** the
variable payloads the server sends. Run it after touching any Shopify call and
before bumping the API version — document validation alone does not catch a
removed input field, which is how `originalUnitPrice` shipped.

---

## Shopify integrations still requiring merchant authorization or secrets

Not verifiable in the Cloud VM and not yet run against the live UPT store. See
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) sections 9–12 for the exact steps.

- Merchant install + scope approval on the UPT shop
- Live draft-order invoices
- Live Shopify Files CDN
- Live `productCreate` / collection / publication
- Outbound email: `RESEND_API_KEY` and a verified `EMAIL_FROM` domain

---

## Required Shopify scopes

Declared in `shopify.app.toml` **and** in `REQUIRED_SHOPIFY_SCOPES`
(`app/lib/env.server.ts`); `app/lib/env.server.test.ts` asserts they match. The
app falls back to the code list when `SCOPES` is unset, so the two cannot drift.

```
write_draft_orders,read_draft_orders,read_orders,read_customers,write_files,read_files,read_products,write_products,read_publications,write_publications
```

Webhooks: `app/uninstalled`, `app/scopes_update`, `orders/paid`, plus the three
compliance topics. `api_version` in `shopify.app.toml` must equal `apiVersion` in
`app/shopify.server.ts`; a test enforces it.

Merchants must re-approve after the product/publication scopes were added.

---

## Current status by subsystem

### Draft orders

Implemented. Accepted plant lines include title, qty 1, price, weight. FedEx line is added only when the customer kept the upgrade. If GraphQL is unavailable, a local checkout-pending URL is stored. Do not create draft orders for rejected-only or all-unavailable responses.

### Shopify Files

Admin photo upload on New requests uses Files when `admin` exists, otherwise `public/uploads/` or data URLs. `fileCreate` is asynchronous, so `uploadPlantPhoto` polls `fileStatus` until `READY` before reading the CDN URL.

The local-disk fallback is **development only** (`localUploadsAllowed()`): that disk is ephemeral and per-instance, so in production a fallback photo would disappear on the next deploy after being frozen into a sent offer snapshot. In production a failed upload surfaces on the request detail page instead. Do not reinstate an unconditional fallback.

Local `/uploads/...` paths are made absolute against `SHOPIFY_APP_URL` when used as EXACT PLANTS media; `data:` URLs cannot be published and approving with no fetchable photo reports an error.

### EXACT PLANTS creation

Implemented as an **admin-approved** path only. Customer reject does not create a product. Review form prefills title, price, weight, photos. It must not prefill or publish customer-facing notes, customer identity, request info, or response info. Cancel creates nothing.

### Online Store / POS publishing

Implemented in GraphQL (`publishablePublish` to catalogs titled `Online Store` and `Point of Sale` / `POS`). Do not publish to other channels. Live publish is untested without a real store.

### Emails

Queued in `EmailMessage`. Delivered through Resend when `RESEND_API_KEY` is set; otherwise status `preview` (and production logs a warning per undelivered message). Transient Resend failures are retried; a permanent failure is summarized into `EmailMessage.error`. Templates exist for received, admin notify, offer ready, confirmation, checkout, expiration reminder, plus `compliance_data_request`.

Customer-facing links in emails are storefront proxy URLs
(`https://{shop}/apps/plant-requests/...`) built by `customerLinksForShop`. A link
to the app's own origin carries no signed identity and renders "Request not
available", so **never** hand a customer a `{appUrl}/customer/...` link.

### Payment webhooks

`POST /webhooks/orders/paid` closes the matching request and marks accepted items Sold. Lookup understands `REQ123` and legacy `UPT-REQ-YYYY-NNNNNN`. A redelivery for an already-paid request is ignored rather than appending a duplicate status event, and every non-match is logged with the order label.

### Expiration logic

`expireOverdueOffers(shop)` flips Pending unpaid requests to Expired when `offer.expiresAt` has passed. Invoked from request loaders and analytics, **and** from the scheduler.

### Two environment modules, deliberately

| Module | Answers |
| --- | --- |
| `app/lib/env.server.ts` | Boot-time contract: `assertProductionEnv()` refuses to start on a bad deploy, `REQUIRED_SHOPIFY_SCOPES` / `grantedScopeWarning()`, `resolveDatabaseUrl()` / `withConnectionLimit()` |
| `app/lib/environment.server.ts` | Per-request, **shop-scoped** runtime gating: `isDemoDataEnabled(shop)`, `canStubShopifyWrites(shop)`, `requireAdminClient()`, `missingProductionSecrets()` for the Settings panel |

`isProductionRuntime()` delegates to `isProduction()` so there is exactly one
definition of "in production". **Do not add a second one** — two that can
disagree is how demo data reaches a real shop or a Shopify write gets silently
faked.

Demo data and Shopify write stubbing are gated on the *shop*, not just on
`NODE_ENV`: a real merchant shop is refused even in development.

### Scheduler

`POST /cron/offer-maintenance` (`app/lib/scheduler.server.ts`) runs `expireOverdueOffers` and `notifyExpirationReminders` for every shop with portal data. Requires `Authorization: Bearer $CRON_SECRET` (constant-time compare) and returns 404 until `CRON_SECRET` is set. Safe to call repeatedly: a reminder is only sent once per request. `GET` is accepted because some hosted schedulers cannot issue `POST`.

In production this is driven by the `upt-offer-maintenance` Render cron job, which runs `scripts/run-offer-maintenance.mjs` hourly. That script is intentionally dependency-free (global `fetch` only) so the cron job does not install the app's dependency tree, and it exits non-zero on any failure so Render marks the run failed. Render cron jobs do not receive `RENDER_EXTERNAL_URL`, so `render.yaml` passes the web service's `RENDER_EXTERNAL_HOSTNAME` in as `APP_HOSTNAME`, and reads `CRON_SECRET` from the web service so there is one value to rotate. `CRON_SECRET` uses `generateValue: true` rather than `sync: false` — it is shared only between two Render services, so there is no reason to make a human produce it.

`GET /healthz` returns 503 when the database is unreachable.

### Customer authentication

- App proxy requests are HMAC-verified (`appProxySignatureIsValid`) before any identity is trusted. The shop comes from the signed `shop` parameter, never from `DEV_SHOP`/`DEMO_SHOP`.
- `logged_in_customer_id` is resolved to a real name and email via the Admin API (`resolveCustomerIdentity`), cached in `CustomerProfile`. Without an email the portal treats the visitor as signed out rather than guessing.
- Unsigned requests to `/customer` return 404 in production.
- Local demo: cookie session, “Continue as logged in customer” → Alex Rivera (`alex.rivera@example.com`). Unavailable in production regardless of `ALLOW_CUSTOMER_DEMO_LOGIN`.
- Customers may only view their own requests.
- Admin demo bypass: `NODE_ENV !== production` and `SHOPIFY_API_KEY=devkey` → shop `DEV_SHOP` or `demo-shop.myshopify.com`. `assertProductionEnv` rejects `SHOPIFY_API_KEY=devkey` in production.
- `ensureShopSeeded` only runs under the dev bypass. **Do not call it from a production code path.**

### Analytics

Read from Prisma. Revenue uses `ShopifyOrderReference.plantRevenue` or draft line items filtered by `kind === "plant"` (FedEx excluded). Behavior flags and item conversion are computed from real request/response/payment data.

### Search

Admin dashboard `matchesAdminSearch` matches customer, email, stored and displayed request numbers, plant name, offered name.

---

## Tests / build / typecheck results

Last verified on `cursor/production-readiness-blockers-7617`:

| Check | Result |
| --- | --- |
| `npm test` | 110 passing, against **both** SQLite and PostgreSQL 16. `pretest` regenerates the Prisma client, so switching `DATABASE_URL` needs no manual step |
| `npm run typecheck` | pass (`react-router typegen && tsc --noEmit`) |
| `npm run lint` | pass |
| `npm run prisma:validate` | pass (both schemas) |
| `npm run prisma:check-schema` | pass |
| `npm run validate-graphql` | pass (17 documents + 9 variable payloads against live Admin `2025-10`) |
| `npm run build` | pass |
| `docker build` + boot on PostgreSQL | pass; migrations applied, `/healthz` 200, container reports `healthy` |
| GitHub CI (`.github/workflows/ci.yml`) | typecheck → lint → both schemas validated → schema-sync check → **tests on SQLite** → **tests on PostgreSQL** → build |

Also verified in the Cloud VM: the app-proxy authorization boundary (a signed
request per customer sees only its own requests; unsigned, replayed, tampered and
wrong-secret requests see nothing), the scheduler expiring an offer and sending
exactly one reminder, and the production env guard refusing to boot on six
misconfigurations.

Live Shopify Admin mutations were still **not** executed — no merchant session
exists. See [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) sections 9–12.

---

## Known issues

- Headless Cloud VM cannot run `shopify app dev` (needs Partner login + tunnel).
- Demo listing products are not real Shopify products; GID looks like `gid://shopify/Product/upt-{itemId}`.
- `shopify.app.toml` carries the production Render URLs, committed because Shopify's TOML cannot read environment variables. `app/lib/shopify-config.test.ts` guards them. **Do not run `shopify app dev` against the production app** — use `shopify app config use dev` (`shopify.app.dev.toml`, separate development app), or the React Router dev server, which needs no Shopify app at all.
- Custom draft-order plant lines do not set `requiresShipping`. Shopify does not document its default and it cannot be tested without a live store, so setting it would be guessing at checkout behaviour. Confirm shipping rates appear at checkout during the live draft-order test and set it then if they do not.
- The CLA workflow was deleted on the production-readiness branch, but it is a `pull_request_target` workflow, which GitHub always runs from the **base** branch. It therefore keeps failing on PR #24 until that deletion is merged to `main`, and disappears for PRs opened afterwards.
- Unused localStorage prototype modules remain in `app/lib/` and can confuse agents; they are not the live data layer.
- `RequestNumberSequence.year` is a leftover of the old yearly scheme; do not reintroduce `UPT-REQ-YYYY-000001`.
- Existing local DBs may still contain leftover `UPT-REQ-2026-000008` / `000009` rows from earlier demos; display maps those to `REQ8` / `REQ9`. Official seeds remap `UPT-REQ-2026-000001`–`000007` and `000099` → `REQ1`–`REQ8`.
- No committed lockfile; `.npmrc` `engine-strict=true` (Node `>=20.19 <22 || >=22.12`). The Dockerfile pins Node 22 for this reason.
- SQLite file is local/ephemeral in Cloud VMs unless the environment snapshot includes it. Production must use PostgreSQL; the app refuses to boot otherwise.

---

## Unfinished work

No known application-code work remains. Everything left needs an account action,
a hosting decision, or a live store — all of it enumerated with exact screens in
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).

**Done:** the Render Blueprint is applied and the web service is live at
`https://upt-plant-request-portal.onrender.com`, verified from outside —
`/healthz` 200, unsigned `/customer` 404, `/cron/offer-maintenance` 401 (so
`CRON_SECRET` is set). `shopify.app.toml` carries the production URLs.

Remaining, all on the user:

1. Confirm the first hourly cron run and the Resend values (runbook §2, §4)
2. Resend API key + verified sending domain (§5)
3. Enable database backups (§6)
4. `shopify app deploy`, then install and approve scopes on the store, and
   confirm the FedEx product handle (§7)
5. Live verification of draft orders, Files, EXACT PLANTS, Online Store/POS,
   `orders/paid` (§8)

Nothing is blocked on an agent.

Genuinely optional, deliberately not done:

- Customer Account OAuth. Not needed: the app-proxy flow now yields a verified
  customer id plus a real name and email from the Admin API.
- Retiring the unused `sample-*` / localStorage modules. No active route imports
  them; deleting them is cosmetic and would add review noise here.

---

## Business rules future agents must preserve

1. **Do not rebuild** the portal. Extend the Prisma-backed React Router app.
2. Request statuses stored: **New / Pending / Closed / Expired**. Customer display: Pending → **Needs Payment** (label only).
3. Customer form: plant name required; notes optional; **no quantity UI**; quantity defaults to 1. **Budget stays out** of the form, customer-facing details, and active workflow. Do not drop `RequestItem.budget` unless a migration is actually required.
4. Name/email come from the customer account when possible. Customers see only their own requests.
5. Offer snapshots freeze name, price, photos, notes, availability after send. Do not edit customer-facing offer fields after send.
6. FedEx upgrade is a separate product, checked by default, warning from Settings, **excluded from plant analytics**. Never create an EXACT PLANTS listing for FedEx.
7. Draft orders only for **accepted** exact plants (plus FedEx if selected).
8. Payment (`orders/paid`) → Closed. Unpaid hold end → Expired.
9. **Declined item** means: UPT marked Available, UPT created an exact-plant offer, customer was given Accept/Reject, customer chose **Reject**. This is **not** UPT Not Available.
10. **Never auto-publish declined items.** Save the rejection; wait for admin review + explicit approve.
11. Listing prefill/publish: title, price, weight, selected exact-plant photos only. Exclude customer-facing notes/disclaimers, customer identity, request information, and customer response information.
12. One Shopify product per declined item. Retries/refreshes/repeated response processing must not duplicate. On failure, keep the rejection and allow idempotent retry.
13. Do not create EXACT PLANTS listings for accepted items, UPT Not Available items, never-offered items, or FedEx.
14. Publish listings only to **Online Store** and **POS**, and add them to the existing **EXACT PLANTS** collection.
15. Request numbers are `REQ1`, `REQ2`, `REQ2178` — sequential, unpadded, shop-wide.

---

## Exact next productionization steps

See [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md). It is ordered, states who
can perform each step, and names the exact screen. Do not start by rewriting the
app, and do not reimplement anything listed there as an account action.

---

## Key files

| Path | Role |
| --- | --- |
| `prisma/schema.prisma` | Data model |
| `app/lib/portal.ts` | Domain types, numbering, status labels, analytics helpers, email copy |
| `app/lib/portal.server.ts` | Persistence |
| `app/lib/exact-plants.ts` / `exact-plants.server.ts` | Declined-item eligibility + listing |
| `app/lib/shopify-ops.server.ts` | Draft orders, Files, product/collection/publish |
| `app/lib/offer-response.server.ts` | Customer accept/reject + draft-order trigger |
| `app/lib/emails.server.ts` | Outbox + Resend |
| `app/lib/analytics.server.ts` | Dashboard analytics |
| `app/lib/seed-demo.server.ts` | Demo seed + legacy number remap |
| `app/lib/admin-auth.server.ts` / `shop.ts` | Admin auth + demo bypass |
| `app/lib/customer-session.server.ts` | Customer cookie / proxy identity |
| `app/routes/app.*.tsx` | Admin UI |
| `app/routes/customer*.tsx` | Customer portal |
| `app/routes/webhooks.orders.paid.tsx` | Payment close |
| `shopify.app.toml` | Scopes, webhooks, app proxy |
| `render.yaml` | Render Blueprint: PostgreSQL, web service, cron job. Checked against the app by `app/lib/render-blueprint.test.ts` |
| `scripts/run-offer-maintenance.mjs` | Render cron job entry point |
| `scripts/prisma.mjs` | Prisma CLI wrapper; picks the schema from `DATABASE_URL` |
| `scripts/validate-admin-graphql.mjs` | Validates Shopify calls against the live Admin schema |
