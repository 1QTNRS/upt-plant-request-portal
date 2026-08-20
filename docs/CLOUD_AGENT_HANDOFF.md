# UPT Plant Request Portal — Cloud Agent Handoff

Durable status for the next Cloud Agent. Do **not** rebuild this app. Continue from the existing React Router + Prisma implementation on the current working branch.

- Repo: `https://github.com/1qtnrs/upt-plant-request-portal`
- Working branch: `cursor/productionize-upt-plant-request-portal-f2dd` (base: `main`)
- Previous branch `cursor/plant-request-portal-persistence-1e21` merged as PR #22

**Productionization pass is complete in code.** The remaining work is merchant-side: install the app on the real UPT shop with the expanded scopes, and set the secrets listed under “Secrets the merchant must provide”. Nothing below requires further application development to install.

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
- Settings: FedEx warning text and admin notification email, plus a banner listing any missing production secrets
- Email outbox rows for request received, admin new-request, offer ready, confirmation, checkout, expiration reminder — deduplicated by idempotency key
- Signature-verified App Proxy customer identity, with name/email resolved from the Admin API
- GDPR compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- Scheduled offer expiry + reminder emails via `POST /cron/offer-maintenance`

Demo seed (`ensureShopSeeded`) creates `REQ1`–`REQ7` sample requests plus `REQ8` (declined Thai Constellation + Not Available String of Pearls) for listing review. It now runs **only on a demo shop** (see “Production vs demo runtime”). `ensureShopSettings` is the unconditional part: it creates the `ShopSettings` row for any shop without seeding fake requests.

---

## Production vs demo runtime

`app/lib/environment.server.ts` is the single gate for every demo affordance.

| Helper | Meaning |
| --- | --- |
| `isProductionRuntime()` | `NODE_ENV === "production"`. Independent of `SHOPIFY_API_KEY=devkey`, so a stray dev key cannot open the admin bypass on a deployed instance |
| `isDemoDataEnabled(shop)` | False in production, false when `UPT_DEMO_DATA=false`, otherwise true only for `DEV_SHOP` / `demo-shop.myshopify.com` |
| `canStubShopifyWrites(shop)` | Whether a missing Admin API client may be faked rather than raised |
| `requireAdminClient(admin, shop, op)` | Returns the client, or `undefined` for a demo shop, or throws `MissingAdminSessionError` |
| `missingProductionSecrets()` | Drives the Settings “Setup required” banner |

What this changed, concretely: on a real merchant shop the app no longer seeds sample requests, no longer serves `picsum.photos` placeholder offer photos, no longer stores base64 data-URL photos when Files upload is unavailable, no longer mints `gid://shopify/Product/upt-{itemId}` stub products, and no longer stores a `?checkout=pending` invoice URL. Each of those now raises instead, so a misconfigured install fails visibly rather than writing fake data the merchant would have to clean up.

---

## Mock / prototype versus production-ready

| Area | Status |
| --- | --- |
| Prisma request/offer/response/listing persistence | Production-ready. `DATABASE_URL` is now env-driven; SQLite still is not a production scale choice |
| Admin UI (dashboard, request detail, analytics, settings, EXACT PLANTS) | Production-ready; local Cloud VM uses `SHOPIFY_API_KEY=devkey` bypass |
| Customer request + offer UI | Production-ready |
| Request numbering `REQn` | Production-ready |
| Shopify Admin OAuth / embedded admin | Implemented via Shopify app template; **not usable in the headless Cloud VM** |
| Customer authentication | **Production-ready.** App Proxy requests are HMAC-verified through `authenticate.public.appProxy`; identity comes from the verified `logged_in_customer_id` and name/email are resolved via the Admin API. Cookie login is demo-shop only |
| Customer authorization | **Production-ready.** `identityOwnsRequest` scopes every read/write; account-claimed requests never fall back to email matching |
| Draft orders | Production-ready and idempotent (`upt-request:{requestId}` tag + `DraftOrderReference` lookup). Requires a real Admin API session; no stub URL outside the demo shop |
| Shopify Files photo upload | Production-ready. Requires a real Admin API session; the data-URL/local-disk fallback is demo-shop only |
| EXACT PLANTS product create + collection + Online Store/POS publish | Production-ready and idempotent, still gated on admin approve. Requires merchant-approved scopes; the demo product GID is demo-shop only |
| Email delivery | Outbox + Resend client; deduplicated by `(shop, idempotencyKey)`. Without `RESEND_API_KEY` messages stay `preview` |
| Expiration reminders | **Scheduled.** `POST /cron/offer-maintenance` (bearer `CRON_SECRET`) runs `expireOverdueOffers` + `notifyExpirationReminders` across installed shops. Needs an external scheduler to call it |
| GDPR compliance webhooks | Implemented (`customers/data_request`, `customers/redact`, `shop/redact`) backed by `app/lib/privacy.server.ts` |
| Unused `app/lib/sample-*.ts`, `item-*.ts`, `customer-*-submissions.ts` localStorage modules | Leftover prototype. **Active routes do not import them.** Do not resurrect them as the source of truth |

---

## Database / schema architecture

Prisma schema: `prisma/schema.prisma`. Provider: SQLite, URL from `env("DATABASE_URL")` (was hardcoded `file:dev.sqlite`). Migrations:

1. `prisma/migrations/20240530213853_create_session_table` — Shopify `Session`
2. `prisma/migrations/20260820061236_plant_request_portal` — portal tables
3. `prisma/migrations/20260820073000_exact_plant_listings` — `ExactPlantListing`
4. `prisma/migrations/20260820160000_email_idempotency_key` — `EmailMessage.idempotencyKey` + unique `(shop, idempotencyKey)`, and an index on `ShopifyOrderReference.shopifyOrderGid`

Migration 4 is additive only: a nullable column plus two indexes. No data is dropped or rewritten, and it is safe to run against an existing database. There is still no destructive migration on `RequestItem.budget` — leave that column alone.

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

Commands: `npm run setup` (`prisma generate && prisma migrate deploy`), `npx prisma db seed`, `npx prisma validate`.

---

## Shopify integrations implemented (in code)

- Admin OAuth via `@shopify/shopify-app-react-router` (`app/shopify.server.ts`, API version October 2025)
- App proxy `/apps/plant-requests` → `/customer`
- Draft order create + invoice send (`createDraftOrderForRequest` in `app/lib/shopify-ops.server.ts`)
- FedEx upgrade product lookup by handle
- Shopify Files staged upload + `fileCreate` (`uploadPlantPhoto`)
- `orders/paid` webhook (`app/routes/webhooks.orders.paid.tsx`) matches `REQ…` or legacy `UPT-REQ-…` tags/notes
- EXACT PLANTS: find/create collection titled `EXACT PLANTS`, `productCreate` with media, variant price + weight (lb), `collectionAddProducts`, `publishablePublish` to Online Store and Point of Sale only
- Idempotency tag `upt-declined-item:{requestItemId}` so retries do not create duplicate products
- Idempotency tag `upt-request:{requestId}` plus a `DraftOrderReference` lookup so retries do not create duplicate draft orders
- GDPR webhooks (`webhooks.customers.data_request.tsx`, `webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx`) → `app/lib/privacy.server.ts`
- `POST /cron/offer-maintenance` for scheduled expiry + reminders

---

## Idempotency map

Every Shopify-side or state-changing create is guarded. Retries, double clicks and webhook redelivery are safe.

| Operation | Guard |
| --- | --- |
| Draft order create | Existing `DraftOrderReference` row, then a Shopify lookup on tag `upt-request:{requestId}` |
| EXACT PLANTS product create | Unique `ExactPlantListing.requestItemId`, then a Shopify lookup on tag `upt-declined-item:{requestItemId}` |
| Email send | `EmailMessage` unique `(shop, idempotencyKey)` |
| Customer offer response | `saveCustomerResponse` creates rather than upserts and raises `OfferAlreadyAnsweredError` on a second answer |
| Request close (`orders/paid`) | `closeRequest` no-ops when already `Closed`, so redelivery adds no duplicate `StatusEvent` |
| Payment marking | `markRequestPaid` no-ops when `paidAt` is already set |

---

## Privacy and authorization

- App Proxy requests are verified with `authenticate.public.appProxy` before any identity is trusted. An unsigned request with a spoofed `logged_in_customer_id` or `x-shopify-customer-id` header resolves to no customer.
- `authenticateCustomer` returns both the verified identity and an Admin API client, so the customer portal can create real draft orders.
- `identityOwnsRequest` (`app/lib/customer-identity.ts`) is the single ownership rule, unit-tested in `customer-identity.test.ts`. When a request is already claimed by a Shopify account, an email-only identity cannot reach it — this closes the shared-email leak.
- `findOrCreateCustomer` rejects an empty email, so unidentified customers can no longer collapse into one shared profile.
- Admin routes that used to write demo data as a customer (`app/customer-request-form`, `app/customer-offer-preview`) are read-only previews outside the demo shop.

---

## Shopify integrations still requiring merchant authorization or secrets

These cannot be completed in the headless Cloud VM and are not verified against a live UPT store. All of them are code-complete; each one needs merchant authorization or a credential:

- Merchant **re-approval** of expanded access scopes (see below)
- Real Shopify Partner app + store install + public tunnel (`shopify app dev`)
- Live Admin API session (`requireAdmin` returns no `admin` client when `SHOPIFY_API_KEY=devkey`)
- Live draft-order invoices
- Live Shopify Files CDN
- Live `productCreate` / collection / publication
- Outbound email: `RESEND_API_KEY` (optional `EMAIL_FROM`, `UPT_ADMIN_EMAIL`)
- An external scheduler pointed at `POST /cron/offer-maintenance`

---

## Secrets the merchant must provide

`.env.example` is the full list. The admin **Settings** page shows a “Setup required” banner naming whichever of these is missing, so the merchant does not have to read this file.

| Variable | Consequence if missing |
| --- | --- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | No embedded admin OAuth; App Proxy signatures cannot be verified, so no customer can sign in |
| `SHOPIFY_APP_URL` | OAuth callbacks and email links break |
| `DATABASE_URL` | App will not boot (Prisma has no datasource) |
| `RESEND_API_KEY` | Emails stay in the outbox as `preview` and are never delivered |
| `EMAIL_FROM`, `UPT_ADMIN_EMAIL` | Optional; admin email also settable in Settings |
| `CRON_SECRET` | `POST /cron/offer-maintenance` rejects every call, so reminders never send |

---

## Required Shopify scopes

From `shopify.app.toml`:

```
write_draft_orders,read_draft_orders,read_orders,read_customers,write_files,read_files,read_products,write_products,read_publications,write_publications
```

Webhooks: `app/uninstalled`, `app/scopes_update`, `orders/paid`, plus the mandatory compliance topics `customers/data_request`, `customers/redact`, `shop/redact`.

Merchants must re-approve after the product/publication scopes were added. The compliance webhooks are required for App Store distribution and are now declared in `shopify.app.toml` and implemented.

---

## Current status by subsystem

### Draft orders

Implemented. Accepted plant lines include title, qty 1, price, weight. FedEx line is added only when the customer kept the upgrade. Do not create draft orders for rejected-only or all-unavailable responses. Creation is idempotent: an existing `DraftOrderReference` short-circuits, and otherwise the app searches Shopify for tag `upt-request:{requestId}` before creating. The local checkout-pending URL fallback survives only for the demo shop; on a real shop a missing Admin client raises `MissingAdminSessionError`.

### Shopify Files

Implemented. Admin photo upload on New requests uses staged upload + `fileCreate`. The `public/uploads/` and data-URL fallbacks are demo-shop only; on a real shop a missing Admin client raises rather than storing a base64 blob in the database.

### EXACT PLANTS creation

Implemented as an **admin-approved** path only. Customer reject does not create a product. Review form prefills title, price, weight, photos. It must not prefill or publish customer-facing notes, customer identity, request info, or response info. Cancel creates nothing.

### Online Store / POS publishing

Implemented in GraphQL (`publishablePublish` to catalogs titled `Online Store` and `Point of Sale` / `POS`). Do not publish to other channels. Live publish is untested without a real store.

### Emails

Queued in `EmailMessage`. Delivered through Resend when `RESEND_API_KEY` is set; otherwise status `preview`. Templates exist for received, admin notify, offer ready, confirmation, checkout, expiration reminder. Every `queueEmail` call carries an idempotency key, enforced by a unique `(shop, idempotencyKey)` index, so a retried action or a redelivered webhook cannot email the customer twice.

### Payment webhooks

`POST /webhooks/orders/paid` closes the matching request and marks accepted items Sold. Lookup understands `REQ123` and legacy `UPT-REQ-YYYY-NNNNNN`. Both `closeRequest` and `markRequestPaid` are no-ops when the request is already in the target state, so Shopify's at-least-once delivery cannot produce duplicate status events or a second confirmation email.

### Expiration logic

`expireOverdueOffers(shop)` flips Pending unpaid requests to Expired when `offer.expiresAt` has passed. Invoked from request loaders and analytics, and now also on a schedule.

`POST /cron/offer-maintenance` (`app/routes/cron.offer-maintenance.tsx`) authorizes with a constant-time comparison against `CRON_SECRET`, enumerates installed shops from the `Session` table, and runs `expireOverdueOffers` + `notifyExpirationReminders` for each. Point any external scheduler at it:

```bash
curl -X POST https://<app-url>/cron/offer-maintenance \
  -H "Authorization: Bearer $CRON_SECRET"
```

`expireOverdueOffers` remains the source of truth for status; the cron endpoint only drives it on a timer.

### Customer authentication

- Production: the App Proxy request is signature-verified by `authenticate.public.appProxy`, then the verified `logged_in_customer_id` is resolved to name/email through the Admin API. Unverified requests and spoofed identity headers are rejected.
- Local demo: cookie session, “Continue as logged in customer” → Alex Rivera (`alex.rivera@example.com`). Demo shop only.
- Customers may only view their own requests, enforced by `identityOwnsRequest`.
- A proxy-authenticated customer with no resolvable email surfaces an identity error rather than falling through to another profile.
- Admin demo bypass: `NODE_ENV !== production` and `SHOPIFY_API_KEY=devkey` → shop `DEV_SHOP` or `demo-shop.myshopify.com`.

### Analytics

Read from Prisma. Revenue uses `ShopifyOrderReference.plantRevenue` or draft line items filtered by `kind === "plant"` (FedEx excluded). Behavior flags and item conversion are computed from real request/response/payment data.

### Search

Admin dashboard `matchesAdminSearch` matches customer, email, stored and displayed request numbers, plant name, offered name.

---

## Tests / build / typecheck results

Last verified on this branch:

| Check | Result |
| --- | --- |
| `npm test` | 37 passing / 19 suites (`portal`, `portal.server`, `exact-plants`, `exact-plants.server`, `customer-identity`, `production-safety.server`) |
| `npm run typecheck` | pass (`react-router typegen && tsc --noEmit`) |
| `npm run lint` | pass |
| `npx prisma validate` | pass |
| `npm run build` | pass |
| GitHub CI (`.github/workflows/ci.yml`) | install → `tsc --noEmit` → lint → prisma generate/validate → build → `prisma migrate deploy && npm test`. **Tests now run in CI.** |

New regression coverage added in this pass:

- `customer-identity.test.ts` — ownership matrix for account id vs email, including the shared-email leak
- `production-safety.server.test.ts` — merchant shops get settings but no sample requests; an offer can be answered only once; `closeRequest` / `markRequestPaid` are idempotent (asserted by comparing the `paidAt` timestamp across repeat calls); email dedupe; cross-account request visibility; customer and shop redaction

Local Cloud VM walkthroughs covered dashboard/search, declined-item review (cancel then approve), listed state, Budget removal, `REQ1` / `REQ2` numbering, App Proxy identity rejection, cron expiry/reminders, and listing-approval idempotency under repeated POSTs. Live Shopify Admin mutations were not executed (no merchant session).

---

## Known issues

- Headless Cloud VM cannot run `shopify app dev` (needs Partner login + tunnel).
- Demo listing products are not real Shopify products; GID looks like `gid://shopify/Product/upt-{itemId}`. This is now demo-shop only.
- The cron endpoint needs an external scheduler; the app does not run its own timer.
- Unused localStorage prototype modules remain in `app/lib/` and can confuse agents; they are not the live data layer.
- `RequestNumberSequence.year` is a leftover of the old yearly scheme; do not reintroduce `UPT-REQ-YYYY-000001`.
- Existing local DBs may still contain leftover `UPT-REQ-2026-000008` / `000009` rows from earlier demos; display maps those to `REQ8` / `REQ9`. Official seeds remap `UPT-REQ-2026-000001`–`000007` and `000099` → `REQ1`–`REQ8`.
- No committed lockfile; `.npmrc` `engine-strict=true` (Node `>=20.19 <22 || >=22.12`).
- SQLite file is local/ephemeral in Cloud VMs unless the environment snapshot includes it.

---

## Unfinished work (no new product features implied)

Nothing here is application code. Every item is a merchant action, a credential, or an optional infrastructure upgrade.

1. Merchant install + scope re-approval on the real UPT shop
2. Live verification of draft orders, Files, EXACT PLANTS create, Online Store/POS
3. Resend (or other) production email credentials
4. Point an external scheduler at `POST /cron/offer-maintenance` with `CRON_SECRET`
5. Optional: retire unused `sample-*` / localStorage modules
6. Optional: Postgres (or Shopify-hosted DB) before real production load — `DATABASE_URL` is already env-driven, so this is a provider swap plus a migration re-baseline
7. Keep the PR draft until the user asks to mark it ready

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
16. Demo data and stub Shopify results are demo-shop only. On any other shop, a missing Admin API client must raise, never fake a result. Do not reintroduce unconditional fallbacks.
17. Customer identity is only ever trusted from a signature-verified App Proxy request. Never read `logged_in_customer_id` or `x-shopify-customer-id` directly off an unverified request.
18. Every Shopify-side create stays idempotent. Preserve the `upt-request:` / `upt-declined-item:` tags, the email idempotency key, and the no-op guards on `closeRequest` / `markRequestPaid`.

---

## Exact next recommended productionization steps

Do these in order. This is now a deployment checklist, not a development plan. Do not start by rewriting the app.

1. **Set the environment** from `.env.example`: `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`. Set `NODE_ENV=production`. Confirm the admin Settings page shows no “Setup required” banner.
2. **Run migrations**: `npx prisma migrate deploy`.
3. **Install / re-approve** the app on the UPT Shopify shop with the full scope list above. Confirm the token includes `write_products`, `read_publications`, and `write_publications`.
4. **Deploy** (or `shopify app dev` with a real tunnel) so embedded admin OAuth and the app proxy work, and **verify admin OAuth** on `/app` without `SHOPIFY_API_KEY=devkey`.
5. **Verify customer sign-in** through the app proxy at `/apps/plant-requests`: a logged-in customer sees only their own requests; a signed-out visitor sees none.
6. **Live draft-order test**: accept an offered plant → confirm Shopify draft order, weights, FedEx variant, invoice send → repeat the accept and confirm no second draft order.
7. **Live Files test**: upload exact-plant photos on a New request → confirm Shopify File CDN URLs on the offer.
8. **Live EXACT PLANTS test**: reject an available offered plant → confirm no product is created → admin review/edit → approve → one product in collection **EXACT PLANTS**, available on Online Store and POS only, not on other channels → second approve does not duplicate.
9. **Send a real email** (offer-ready + confirmation) and confirm the outbox row flips off `preview`.
10. **Schedule the cron**: `POST /cron/offer-maintenance` with `Authorization: Bearer $CRON_SECRET`, hourly or daily.
11. **Confirm the compliance webhooks** respond 200 in the Partner dashboard.
12. **Only then** consider SQLite → Postgres and deleting unused prototype files.

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
| `app/lib/environment.server.ts` | Production vs demo gate, `requireAdminClient`, missing-secret report |
| `app/lib/customer-session.server.ts` | Verified App Proxy identity + Admin client for the customer portal |
| `app/lib/customer-identity.ts` | `identityOwnsRequest` ownership rule |
| `app/lib/privacy.server.ts` | GDPR export / redaction |
| `app/routes/app.*.tsx` | Admin UI |
| `app/routes/customer*.tsx` | Customer portal |
| `app/routes/webhooks.orders.paid.tsx` | Payment close |
| `app/routes/webhooks.customers.*.tsx`, `webhooks.shop.redact.tsx` | GDPR compliance |
| `app/routes/cron.offer-maintenance.tsx` | Scheduled expiry + reminder emails |
| `shopify.app.toml` | Scopes, webhooks, app proxy |
| `.env.example` | Every environment variable |
