# UPT Plant Request Portal — Cloud Agent Handoff

Durable status for the next Cloud Agent. Do **not** rebuild this app. Continue from the existing React Router + Prisma implementation on the current working branch.

- Repo: `https://github.com/1qtnrs/upt-plant-request-portal`
- Working branch: `cursor/plant-request-portal-persistence-1e21` (base: `main`)
- Pull request: https://github.com/1qtnrs/upt-plant-request-portal/pull/22 (keep **draft** until the user asks to mark it ready)

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
| Prisma request/offer/response/listing persistence | Production-ready in code; SQLite is fine for demo, not a production scale choice |
| Admin UI (dashboard, request detail, analytics, settings, EXACT PLANTS) | Production-ready in code; local Cloud VM uses `SHOPIFY_API_KEY=devkey` bypass |
| Customer request + offer UI | Production-ready in code |
| Request numbering `REQn` | Production-ready in code |
| Shopify Admin OAuth / embedded admin | Implemented via Shopify app template; **not usable in the headless Cloud VM** |
| Customer authentication | **Partial.** App proxy can pass `logged_in_customer_id`; demo cookie login is development-only. Full Customer Account OAuth is not implemented |
| Draft orders | Code complete; live invoice URLs require a real Admin API session |
| Shopify Files photo upload | Code complete; live CDN URLs require a real Admin API session. Local fallback writes `public/uploads/` or data URLs |
| EXACT PLANTS product create + collection + Online Store/POS publish | Code complete; live create requires merchant-approved scopes and a real Admin API session. Local demo (`admin` undefined) saves a demo product GID/handle **only after admin approve** |
| Email delivery | Outbox + Resend client implemented; without `RESEND_API_KEY` messages stay `preview` |
| Expiration reminders | Builder + `notifyExpirationReminders()` exist; **nothing schedules that function** |
| Unused `app/lib/sample-*.ts`, `item-*.ts`, `customer-*-submissions.ts` localStorage modules | Leftover prototype. **Active routes do not import them.** Do not resurrect them as the source of truth |

---

## Database / schema architecture

Prisma schema: `prisma/schema.prisma`. Provider: SQLite `file:dev.sqlite` (gitignored). Migrations:

1. `prisma/migrations/20240530213853_create_session_table` — Shopify `Session`
2. `prisma/migrations/20260820061236_plant_request_portal` — portal tables
3. `prisma/migrations/20260820073000_exact_plant_listings` — `ExactPlantListing`

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

---

## Shopify integrations still requiring merchant authorization or secrets

These cannot be completed in the headless Cloud VM and are not verified against a live UPT store:

- Merchant **re-approval** of expanded access scopes (see below)
- Real Shopify Partner app + store install + public tunnel (`shopify app dev`)
- Live Admin API session (`requireAdmin` currently returns no `admin` client when `SHOPIFY_API_KEY=devkey`)
- Live draft-order invoices
- Live Shopify Files CDN
- Live `productCreate` / collection / publication
- Customer Account authentication (or a complete app-proxy identity that includes name/email, not only customer id)
- Outbound email: `RESEND_API_KEY` (optional `EMAIL_FROM`, `UPT_ADMIN_EMAIL`)

---

## Required Shopify scopes

From `shopify.app.toml`:

```
write_draft_orders,read_draft_orders,read_orders,read_customers,write_files,read_files,read_products,write_products,read_publications,write_publications
```

Webhooks: `app/uninstalled`, `app/scopes_update`, `orders/paid`.

Merchants must re-approve after the product/publication scopes were added.

---

## Current status by subsystem

### Draft orders

Implemented. Accepted plant lines include title, qty 1, price, weight. FedEx line is added only when the customer kept the upgrade. If GraphQL is unavailable, a local checkout-pending URL is stored. Do not create draft orders for rejected-only or all-unavailable responses.

### Shopify Files

Implemented with local fallback. Admin photo upload on New requests uses Files when `admin` exists, otherwise `public/uploads/` or data URLs.

### EXACT PLANTS creation

Implemented as an **admin-approved** path only. Customer reject does not create a product. Review form prefills title, price, weight, photos. It must not prefill or publish customer-facing notes, customer identity, request info, or response info. Cancel creates nothing.

### Online Store / POS publishing

Implemented in GraphQL (`publishablePublish` to catalogs titled `Online Store` and `Point of Sale` / `POS`). Do not publish to other channels. Live publish is untested without a real store.

### Emails

Queued in `EmailMessage`. Delivered through Resend when `RESEND_API_KEY` is set; otherwise status `preview`. Templates exist for received, admin notify, offer ready, confirmation, checkout, expiration reminder.

### Payment webhooks

`POST /webhooks/orders/paid` closes the matching request and marks accepted items Sold. Lookup understands `REQ123` and legacy `UPT-REQ-YYYY-NNNNNN`.

### Expiration logic

`expireOverdueOffers(shop)` flips Pending unpaid requests to Expired when `offer.expiresAt` has passed. Invoked from request loaders and analytics. **Expiration reminder emails are not on a schedule.**

### Customer authentication

- Production intent: Shopify customer logged in via app proxy (`logged_in_customer_id` / `x-shopify-customer-id`)
- Local demo: cookie session, “Continue as logged in customer” → Alex Rivera (`alex.rivera@example.com`)
- Customers may only view their own requests
- Admin demo bypass: `NODE_ENV !== production` and `SHOPIFY_API_KEY=devkey` → shop `DEV_SHOP` or `demo-shop.myshopify.com`

### Analytics

Read from Prisma. Revenue uses `ShopifyOrderReference.plantRevenue` or draft line items filtered by `kind === "plant"` (FedEx excluded). Behavior flags and item conversion are computed from real request/response/payment data.

### Search

Admin dashboard `matchesAdminSearch` matches customer, email, stored and displayed request numbers, plant name, offered name.

---

## Tests / build / typecheck results

Last verified on this branch:

| Check | Result |
| --- | --- |
| `npm test` | 22 passing (`portal`, `portal.server`, `exact-plants`, `exact-plants.server`) |
| `npm run typecheck` | pass (`react-router typegen && tsc --noEmit`) |
| `npm run lint` | pass |
| `npx prisma validate` | pass |
| `npm run build` | pass |
| GitHub CI (`.github/workflows/ci.yml`) | install → `tsc --noEmit` → lint → prisma generate/validate → build. **Does not run `npm test`.** |

Local Cloud VM walkthroughs covered dashboard/search, declined-item review (cancel then approve), listed state, Budget removal, and `REQ1` / `REQ2` numbering. Live Shopify Admin mutations were not executed (no merchant session).

---

## Known issues

- Headless Cloud VM cannot run `shopify app dev` (needs Partner login + tunnel).
- Demo listing products are not real Shopify products; GID looks like `gid://shopify/Product/upt-{itemId}`.
- `notifyExpirationReminders` is never called from a route, webhook, or cron.
- App-proxy customer id without email/name cannot fully populate `CustomerProfile` until a richer identity source exists.
- Unused localStorage prototype modules remain in `app/lib/` and can confuse agents; they are not the live data layer.
- `RequestNumberSequence.year` is a leftover of the old yearly scheme; do not reintroduce `UPT-REQ-YYYY-000001`.
- Existing local DBs may still contain leftover `UPT-REQ-2026-000008` / `000009` rows from earlier demos; display maps those to `REQ8` / `REQ9`. Official seeds remap `UPT-REQ-2026-000001`–`000007` and `000099` → `REQ1`–`REQ8`.
- No committed lockfile; `.npmrc` `engine-strict=true` (Node `>=20.19 <22 || >=22.12`).
- SQLite file is local/ephemeral in Cloud VMs unless the environment snapshot includes it.

---

## Unfinished work (no new product features implied)

1. Merchant install + scope re-approval on the real UPT shop
2. Live verification of draft orders, Files, EXACT PLANTS create, Online Store/POS
3. Customer Account OAuth / complete logged-in customer identity
4. Resend (or other) production email credentials
5. Scheduler for expiration reminders
6. Optional: add `npm test` to CI
7. Optional: retire unused `sample-*` / localStorage modules
8. Optional: Postgres (or Shopify-hosted DB) before real production load
9. Do not mark PR 22 ready until the user asks

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

## Exact next recommended productionization steps

Do these in order. Do not start by rewriting the app.

1. **Install / re-approve** the app on the UPT Shopify shop with the full scope list above. Confirm the token includes `write_products`, `read_publications`, and `write_publications`.
2. **Run `shopify app dev` (or deploy)** with a real tunnel/`SHOPIFY_APP_URL` so embedded admin OAuth and the app proxy work.
3. **Verify admin OAuth** on `/app` without `SHOPIFY_API_KEY=devkey`.
4. **Complete customer identity**: app proxy must yield a stable customer id **and** name/email, or implement Customer Account auth. Keep the private-by-account rule.
5. **Live draft-order test**: accept an offered plant → confirm Shopify draft order, weights, FedEx variant, invoice send.
6. **Live Files test**: upload exact-plant photos on a New request → confirm Shopify File URLs on the offer.
7. **Live EXACT PLANTS test**: reject an available offered plant → confirm no product is created → admin review/edit → approve → one product in collection **EXACT PLANTS**, available on Online Store and POS only, not on other channels → second approve does not duplicate.
8. **Set email secrets** (`RESEND_API_KEY`, `EMAIL_FROM`, Settings admin email or `UPT_ADMIN_EMAIL`) and send a real offer-ready + confirmation message.
9. **Wire expiration reminders** by calling `notifyExpirationReminders` on a schedule (cron, background job, or Shopify Flow / webhook). Keep `expireOverdueOffers` as the status source of truth.
10. **Add `npm test` to CI** so listing/idempotency/numbering regressions fail the build.
11. **Only then** consider SQLite → Postgres and deleting unused prototype files.

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
