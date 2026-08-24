# UPT Plant Request Portal — Cloud Agent Handoff

Durable status for the next Cloud Agent. Do **not** rebuild this app. Continue from the existing React Router + Prisma implementation.

- Repo: `https://github.com/1qtnrs/upt-plant-request-portal`
- PR #22 (Prisma persistence + declined EXACT PLANTS listings) is **merged to `main`**.
- Working branch: `cursor/auto-merge-exact-plants-table-5eef` (base: `main`) — automated delivery + EXACT PLANTS table.
- Read [AUTOMATED_DELIVERY.md](AUTOMATED_DELIVERY.md) before merging routine work or running smoke tests.

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
- Admin dashboard with search (customer name, email, request number, plant/offered name) and a stored-status filter (All / New / Pending / Expired / Closed). Search and status combine. Overview stat counts stay on the full dataset.
- Admin request detail: three fulfilment routes per item — Offer Exact Plant / Link Existing Website Stock / Not Available — offered name, price, weight, customer-facing notes, multi-photo upload
- Grower's Choice: admin searches the shop's live Shopify products and variants, links a purchasable one, and the draft order sells that real variant with a Shopify inventory reservation ending at the customer's payment deadline
- Offer send with 3/5/7 day hold; offer snapshot freezes name, price, weight, photos, notes, availability, fulfilment route and the linked product/variant titles
- Customer offer: Accept / Reject for Available items only; Not Available cannot be accepted or rejected
- FedEx Priority Overnight upgrade: checked and enabled while one or more purchasable plants are accepted; auto-unchecked, disabled and greyed out at zero accepted; settings-driven removal warning only while something remains accepted; excluded from plant analytics
- Draft-order creation for **accepted plants only** (GraphQL when an Admin API client exists; demo fallback invoice URL otherwise)
- `orders/paid` webhook → request **Closed**, accepted items **Sold**
- Unpaid offer expiry → **Expired** (checked when loading requests / analytics), then `draftOrderDelete` so the issued invoice 404s
- Declined exact-plant listing review: customer reject is saved **without** publishing; admin must review and approve before any Shopify product is created. **Dismiss from EXACT PLANTS** (confirmation required) removes an eligible, not-yet-listed queue item without creating a product or deleting history; `exactPlantDismissedAt` plus `Admin Dismissed from EXACT PLANTS` keep it out of later queue refreshes. Already-listed products cannot be dismissed or deleted this way. The admin queue is a collapsible **sortable table** (photo lightbox, Request # link, eligibility, listing status, price, date, actions). Eligibility rules are unchanged.
- After admin approval: one Shopify product per declined item, EXACT PLANTS collection, Online Store + POS only, idempotent retries, **Listed** status + product link
- Analytics from the database (FedEx excluded from plant revenue/counts)
- Settings: FedEx warning text and admin notification email
- Email outbox rows for request received, admin new-request, offer ready, confirmation, checkout, expiration reminder
- Admin override **Close Entire Request** (confirmation required; writes `Admin Override Close`; voids an unpaid Draft Order; declined Exact Plants stay EXACT PLANTS-eligible; Grower's Choice stays excluded)
- Admin-only **Open Draft Order in Shopify** on request detail when a live GID exists; voided drafts show the void timestamp instead of a live link
- Customer request-detail support note on New / Pending only (`support@unsolicitedplanttalks.com`), pointing customers back to the portal for ordinary tracking

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
| Customer authentication | App proxy requests are HMAC-verified, writes must also come from a storefront of the signed shop, and the customer's real name/email is read from the Admin API. Unsigned requests are refused in production. Customer Account OAuth is still not implemented and is not needed for the app-proxy flow |
| Draft orders | Code complete and schema-validated; the customer path now gets an offline Admin client. **Not yet run against a live store** |
| Shopify Files photo upload | Code complete; waits for `fileStatus: READY`. **Not yet run against a live store** |
| EXACT PLANTS product create + collection + Online Store/POS publish | Code complete and schema-validated. **Not yet run against a live store** |
| Email delivery | Outbox + Resend client with retries, error reporting and an hourly redelivery sweep; without `RESEND_API_KEY` messages stay `preview`, and with a key but an unverified sending domain Resend returns 403 and the row becomes `failed`. Production logs a warning per undelivered message, and the admin request page shows the outbox |
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
4. `20260820160000_email_idempotency_key` — `EmailMessage.idempotencyKey`
5. `20260821100000_email_delivery_attempts` — `EmailMessage` delivery attempt columns
6. `20260821110000_portal_lookup_indexes` — admin/customer lookup indexes
7. `20260822060000_canonical_plant_identity` — `CanonicalPlant`, `PlantNameAlias`,
   `PlantIdentitySuggestion`, and `RequestItem.canonicalPlantId`. Purely additive:
   the column is nullable and added with `ALTER TABLE ADD COLUMN` rather than the
   table rebuild Prisma would otherwise emit for a new SQLite foreign key, so it
   cannot fail on a database that already holds request items
8. `20260822120000_growers_choice_fulfillment` — `fulfillmentType` and the linked
   variant snapshot on `RequestItem`, `OfferItem` and `ResponseItem`, plus
   `DraftOrderReference.reserveInventoryUntil`. Purely additive: `fulfillmentType`
   carries a non-null default of `exact_plant`, so every existing row reads as the
   route it was created under, and every other column is nullable
9. `20260824190000_admin_mobile_tokens` — `AdminMobileToken` for the iOS admin app

PostgreSQL migrations (`prisma/postgres/migrations/`) started as a single squashed
`20260820120000_init`, since production starts from an empty database; later
migrations are added under both directories.

Shop-scoped models (multi-tenant by `shop` string):

- `ShopSettings` — FedEx warning, product handle/variant GID, upgrade price/label, admin email. Live FedEx listing is SKU `UPTUPGTOFED1236S`
- `RequestNumberSequence` — still keyed by `(shop, year)`; live numbering uses `year = 0` (`GLOBAL_REQUEST_SEQUENCE_YEAR`) for a shop-wide counter
- `CustomerProfile` — unique `(shop, email)`
- `PlantRequest` — statuses stored as `New` / `Pending` / `Closed` / `Expired`
- `RequestItem` — plant line; `budget` column **kept but unused** in the active workflow (do not destructive-migrate solely to drop it). `fulfillmentType` is `exact_plant` \| `growers_choice`; **`not_available` is never stored** — it is derived from `availability`, because storing it twice is how the two come to disagree. `linked*` columns are the store listing a Grower's Choice line draws on, and `fulfillmentIssue` is why its stock could not be held
- `PhotoReference` — ordered photos on a request item
- `Offer` + `OfferItem` — immutable offer snapshot
- `CustomerResponse` + `ResponseItem` — customer choices (`accept` / `reject` / `unavailable`)
- `DraftOrderReference` / `ShopifyOrderReference`. `DraftOrderReference` doubles as the mutual exclusion around draft-order creation: a row with `invoiceUrl = null` is a **claim**, not a draft order, and the unique index on `requestId` is what stops two callers reserving the same plant
- `ResponseItem` — also freezes the fulfilment route and the linked product/variant titles the customer answered on, so a later Shopify rename cannot rewrite history
- `StatusEvent` / `EmailMessage`
- `ExactPlantListing` — unique `requestItemId`; stores approved title/price/weight/photos, Shopify product GID/handle, `listed` \| `failed`, `lastError`
- `CanonicalPlant` — unique `(shop, canonicalKey)`; the identity analytics group on. `displayName` is the first spelling the shop saw
- `PlantNameAlias` — unique `(shop, aliasKey)`; one customer spelling → one `CanonicalPlant`. `source` is `deterministic` or `admin_confirmed`
- `PlantIdentitySuggestion` — unique `(shop, aliasKey, suggestedCanonicalPlantId)`; a medium-confidence match awaiting Same Plant / Keep Separate. `status` is `open` \| `confirmed` \| `rejected`
- `AdminMobileToken` — hashed device tokens for the iOS admin app. Plaintext is shown once on create; revoke sets `revokedAt`

Item statuses: `Requested` | `Sourced` | `Offered` | `Sold` | `Unavailable` | `Listed`.

Commands: `npm run setup`, `npm run prisma:generate`, `npm run prisma:migrate`,
`npm run prisma:validate` (both schemas), `npm run prisma:sync-schema`,
`npm run prisma:check-schema`, `node scripts/prisma.mjs db seed`.

---

## Shopify integrations implemented (in code)

- Admin OAuth via `@shopify/shopify-app-react-router` (`app/shopify.server.ts`, API version April 2026 / `2026-04`)
- App proxy `/apps/plant-requests` → `/customer`, **HMAC-verified** (`app/lib/app-proxy.ts`)
- Offline Admin client for the app-proxy customer path (`app/lib/offline-admin.server.ts`). Goes through `unauthenticated.admin(shop)`, which calls `ensureValidOfflineSession` and therefore refreshes the token under the `expiringOfflineAccessTokens` future flag — the customer draft-order path does not break when the offline token expires.
- Customer name/email resolved from the Admin API and cached in `CustomerProfile` (`app/lib/customer-identity.server.ts`)
- Request ownership decided by `identityOwnsRequest` (`app/lib/customer-identity.ts`, pure). A request already claimed by a Shopify account id is **never** reachable by email, so changing an account email cannot reach a stranger's request
- Draft order create + invoice send (`createDraftOrderForRequest` in `app/lib/shopify-ops.server.ts`), custom lines priced with `originalUnitPriceWithCurrency`
- FedEx upgrade product lookup by live SKU `UPTUPGTOFED1236S` (`productVariants`), then handle via `productByIdentifier`
- Shopify Files staged upload + `fileCreate`, polling `fileStatus` until `READY` (`uploadPlantPhoto`)
- `orders/paid` webhook (`app/routes/webhooks.orders.paid.tsx`) matches `REQ…` or legacy `UPT-REQ-…` tags/notes, ignores redeliveries for an already-paid request
- Mandatory privacy webhooks: `customers/data_request`, `customers/redact`, `shop/redact` (`app/lib/compliance.server.ts`)
- Existing-stock search over `products(query:)` **and** `productVariants(query:)` in one document, merged on variant id (`searchExistingStock`). `products` reaches the product's own text and its variants' SKUs; `productVariants` reaches a variant title, which on a plant store is where the size lives
- Draft orders are idempotent three times over: a recorded `DraftOrderReference` with a checkout link short-circuits, `draftOrderIdempotencyTag` finds a draft order Shopify already created when a previous reply was lost, and `claimDraftOrderCreation` makes the window between those two exclusive. Without the first two a retry bills the customer twice; without the third two concurrent callers reserve the same plant twice
- Outbound email is deduplicated on `EmailMessage.idempotencyKey` (`@@unique([shop, idempotencyKey])`), so a retry or a double form submit cannot send the same message twice
- EXACT PLANTS: find/create collection titled `EXACT PLANTS`, `productCreate` with media, variant price + weight (lb) + tracked stock of one, `collectionAddProducts`, `publishablePublish` to Online Store and Point of Sale only (paginating all publications)
- Idempotency tag `upt-declined-item:{requestItemId}` so retries do not create duplicate products; a retry updates the existing product instead

### Verifying Shopify calls without a store

`npm run validate-graphql` fetches the live Admin schema for the version in
`app/shopify.server.ts` and validates every `#graphql` document **and** the
variable payloads the server sends. Run it after touching any Shopify call and
before bumping the API version — document validation alone does not catch a
removed input field, which is how `originalUnitPrice` shipped.

It is necessary and **not sufficient**. Everything in the next section validated
cleanly and was still wrong.

### Shopify facts the schema and the docs do not tell you

Each of these was found by asking a real store and would have shipped otherwise.
Re-check them when bumping the API version.

| What the documentation implies | What a store actually returns |
| --- | --- |
| `Publication.name` is deprecated, "use `Catalog.title`" | `catalog` is **null** unless the query passes `catalogType`. With `catalogType: APP` the title reads `Channel Catalog 329323446315 for Online Store` — and is translated into the merchant's admin language. Title matching cannot work; match `AppCatalog.apps.nodes.handle` |
| The POS channel handle is `point_of_sale` | It is **`pos`**. Both are accepted in `POS_APP_HANDLES` |
| `Shop.domains` is deprecated, "use `domainsPaginated`" | `domainsPaginated` does not exist on `Shop` in 2025-10; `validate-graphql` rejects it |
| A granted scope list echoes what was requested | Shopify folds `read_x` into the `write_x` that implies it. A store that approved everything reports `write_products` and no `read_products` — see `coveredScopes` in `env.server.ts`. `currentAppInstallation.accessScopes` returns the *expanded* list, so the two sources disagree by design |
| `inventorySetQuantities` takes quantities | On `2026-04` each quantity must send `changeFromQuantity` (the observed available qty — never `null`) and the mutation must carry `@idempotent`. `ignoreCompareQuantity` was removed. |

### Verifying against the dev store without a browser

The app is installed on `upt-plant-request-dev.myshopify.com`, and the whole
workflow can be driven over HTTP:

- **Customer** — sign a query string the way `appProxySignatureIsValid` verifies
  it and send it with the storefront `Origin`. Signatures are only valid for
  five minutes.
- **Admin** — mint a Shopify session token (HS256 over the app's client secret,
  with `iss`/`dest`/`aud` for the shop) and send it as `id_token`. Because a
  valid offline session exists, `authenticate.admin` loads it rather than
  attempting a token exchange, and the route gets a **real** Admin API client.
  Two gotchas: send a browser `User-Agent`, or `isbot` returns 410 Gone; and the
  offline session expires hourly, after which `authenticate.admin` refuses to
  reuse it. Any customer request through the proxy renews it, because
  `unauthenticated.admin` refreshes with the stored refresh token.
- **Database and store internals** — a Render one-off job
  (`POST /v1/services/{id}/jobs`) runs Node inside the deployed image with
  `DATABASE_URL` and the offline token in scope. Render execs the start command
  without a shell, so keep pipes and redirects out of it.

**Never point a Prisma command at the live database as a shadow database.**
`prisma migrate diff --shadow-database-url "$DATABASE_URL"` reads like an
inspection command and is not: Prisma empties whatever it is given as a shadow
database. Run against the live dev database it destroyed every row, including
the Shopify offline session, which no amount of app-side credentials can
recreate. It was recovered with Render point-in-time recovery (available on all
paid plans; 3 days on Hobby, 7 on Pro) by restoring to a new instance, copying
the `Session` row back, and deleting the instance. `migrate dev`, `migrate reset`
and `db push` are the same class of hazard.

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
write_draft_orders,read_draft_orders,read_orders,read_customers,write_files,read_files,read_products,write_products,read_publications,write_publications,write_inventory,write_app_proxy
```

`write_inventory` is what lets an EXACT PLANTS listing stock the one plant it
sells. It also covers reading `Location.id`, which is the only Location field
the app touches — anything more would additionally need `read_locations`.

Grower's Choice added **no scope**. Searching products and variants and reading
one back by id is `read_products`, which `write_products` already covers; the
hold is taken by `draftOrderCreate` under `write_draft_orders` and
`write_inventory`. Nothing here needs the merchant to re-approve.

`write_app_proxy` is what makes the `[app_proxy]` block take effect. Without it
the storefront address customers use — `https://<shop>/apps/plant-requests` —
404s, even though every other part of the app is configured correctly.

Webhooks: `app/uninstalled`, `app/scopes_update`, `orders/paid`, plus the three
compliance topics. `api_version` in `shopify.app.toml` must equal `apiVersion` in
`app/shopify.server.ts`; a test enforces it.

Merchants must re-approve after the product/publication scopes were added.

---

## Current status by subsystem

### Draft orders

Implemented. Accepted plant lines include title, qty 1, price, weight. FedEx line is added only when the customer kept the upgrade. If GraphQL is unavailable, a local checkout-pending URL is stored. Do not create draft orders for rejected-only or all-unavailable responses.

`ShopSettings.fedexUpgradePrice` is the single FedEx amount: it is what the offer
quotes, what the response snapshot freezes and what the confirmation email
states. `resolveFedexVariant` writes it from the live variant price, and sending
an offer refreshes it first (`refreshFedexUpgradePrice`, best effort — Shopify
being unreachable must not block the offer). The draft-order FedEx line carries
that frozen amount as `originalUnitPriceWithCurrency` alongside `variantId`, so
Shopify bills what the customer answered rather than whatever the variant costs
by the time they open the invoice. It previously sent `variantId` alone, which
quoted $15 and billed the store's price.

### Grower's Choice from existing website stock

The second fulfilment route. A plant is supplied from a variant the store already
lists rather than one sourced and photographed for one customer. All of the
vocabulary — which route an item is on, whether a variant may be linked, the
search query, the weight, the hold state — lives in `app/lib/growers-choice.ts`,
which is deliberately **free of imports**: `portal.ts` reads it to decide whether
an offer can be sent, so anything imported there would pull `portal.ts` back in a
circle.

Only a **purchasable** variant may be linked: `ACTIVE` product, a price above
zero, `availableForSale`, and either untracked stock or at least one unit.
`unlinkableVariantReason` returns the reason instead, and search results include
the unlinkable ones with it — a silently shortened list reads as "we do not sell
that plant", which sends the admin to source one they already have.

Untracked stock is allowed and is **not** the same as stock of zero: Shopify has
no counter for it, so there is nothing to be short of and nothing to reserve.

Linking reserves nothing. It records which listing the plant would come from,
and the price and weight to prefill; the item's own weight is only a fallback for
a variant whose weight the merchant never filled in.

**Reservation happens once, when the draft order is created for an accepted
plant**, and Shopify is what does the holding:

1. `acceptedOfferLines` reads the accepted lines out of the frozen offer and
   response snapshots, so the order bills the variant and price the customer
   answered even if the listing has since been relinked or repriced.
2. `claimDraftOrderCreation` takes exclusive right to create this request's
   draft order. Reading "nothing recorded" and creating one are separated by
   several Shopify round trips, and two callers through that window would both
   ask Shopify to hold the same plant.
3. `assertLinkedStockStillAvailable` re-reads the live variants and refuses with
   `InsufficientStockError`, naming the plant. Quantities are summed **per
   variant** first: two accepted lines pointing at one listing need two units
   between them, and checking each against the same single unit would pass both.
4. `reserveInventoryUntilFor` sets `DraftOrderInput.reserveInventoryUntil` to the
   offer's own expiry — the end of the hold the customer was already promised.
   Nothing is asked for unless a **plant** line sells store stock: asking on an
   all-exact-plant order would newly hold the FedEx upgrade variant, which is a
   shipping service and has never been held for anyone.
5. The granted deadline is read **back** from Shopify, not assumed from what was
   sent. A hold asked for and not granted leaves the plant on open sale, so it is
   recorded as a `fulfillmentIssue` rather than as a request page claiming the
   plant is held.

The pre-check is a courtesy, not the guarantee: anyone can buy the last plant
between that answer and the reservation. What actually prevents an oversell is
Shopify refusing — reported as a stock problem naming the plant rather than a
generic failure, because `draftOrderCreate` returns it as an ordinary user error.
On any failure nothing is created, so nothing is payable and nothing is charged,
and the claim is given back so the merchant can retry as soon as they restock.

Shopify also lets the hold go by itself at `reserveInventoryUntil` and turns it
into a real deduction when the order is paid, so an unpaid expiry still releases
the stock even while the portal is down. Observed on the dev store: the hold
shows as **reserved** (not committed), `available` goes to 0, and
`draftOrderDelete` returns that draft's reserved quantity immediately. The
hourly sweep and the first page load after expiry also delete the unpaid draft
so the invoice cannot be paid after the unit is back on sale.
`inventoryHoldState` only reads which of those has happened, for the request page.

A rejected Grower's Choice item does **not** enter the EXACT PLANTS queue: the
product already exists in the store, and listing it again would create a second
product for a plant that already has one. A rejected exact plant still does.

The offer banner and the offer-ready email say "these exact plants are being held
for you" only when `offerIsAllExactPlants`. A Grower's Choice plant is picked from
stock at dispatch, so on an offer carrying one the sentence drops "exact" — beside
a listing photo it otherwise promises the individual that the disclosure directly
under it takes back.

### Shopify Files

Admin photo upload on New requests uses Files when `admin` exists, otherwise `public/uploads/` or data URLs. `fileCreate` is asynchronous, so `uploadPlantPhoto` polls `fileStatus` until `READY` before reading the CDN URL.

The local-disk fallback is **development only** (`localUploadsAllowed()`): that disk is ephemeral and per-instance, so in production a fallback photo would disappear on the next deploy after being frozen into a sent offer snapshot. In production a failed upload surfaces on the request detail page instead. Do not reinstate an unconditional fallback.

Local `/uploads/...` paths are made absolute against `SHOPIFY_APP_URL` when used as EXACT PLANTS media; `data:` URLs cannot be published and approving with no fetchable photo reports an error.

### EXACT PLANTS creation

Eligibility is `exactPlantReleaseReason` (`app/lib/exact-plants.ts`), the one
rule used by the listing queue, the review form and analytics. Candidates are
queried from **offer items**, not from customer responses: an offer that simply
expired has no response rows, so starting from the response would silently miss
every unanswered expired offer.

`EXACT_PLANT_ITEM_TAG_PREFIX` still reads `upt-declined-item:` although expired
offers are now eligible too. It is the Shopify idempotency tag — renaming it
would orphan the products already created under it and allow duplicates.


Implemented as an **admin-approved** path only. Customer reject does not create a product. Review form prefills title, price, weight, photos. It must not prefill or publish customer-facing notes, customer identity, request info, or response info. Cancel creates nothing.

### Online Store / POS publishing

Implemented in GraphQL (`publishablePublish`). Do not publish to other channels. Live publish is untested without a real store.

The publications are found by the **app handle** behind each one —
`online_store` and `point_of_sale` — never by the catalog title.
`publications` must be queried with `catalogType: APP`: without it Shopify
returns `catalog: null` for every publication, so nothing matched and no listing
could ever be published. With it, the catalog title reads "Channel Catalog
&lt;id&gt; for Online Store" and is translated into the merchant's admin
language, so it is not something to match on.

### One plant, one unit of stock

An EXACT PLANTS listing is one specific physical plant. The variant is created
tracked (`inventoryItem.tracked`), `inventoryPolicy: DENY`, and stocked with a
quantity of 1 at the shop's primary location, all **before** `publishablePublish`
— an untracked plant can be bought by several customers at once, and a tracked
plant published before it is stocked shows as sold out.

`inventoryQuantities` on `ProductVariantsBulkInput` is only honoured by
`productVariantsBulkCreate`, so the quantity needs its own call:
`inventorySetQuantities` when Shopify already stocks the item at that location,
`inventoryActivate` when it does not. Both mutations send `@idempotent` with a
deterministic key from the request item and operation. `inventorySetQuantities`
passes the quantity we just read as `changeFromQuantity` so a concurrent retry
cannot overwrite a different stock level. A stale compare re-reads and retries
with a new key; a concurrent idempotency error retries the same payload and key.
Do not pass `changeFromQuantity: null` to skip the check.

### Emails

Queued in `EmailMessage`. Delivered through Resend when `RESEND_API_KEY` is set; otherwise status `preview` (and production logs a warning per undelivered message). Templates exist for received, admin notify, offer ready, confirmation, admin response, checkout, expiration reminder, plus `compliance_data_request`.

Volume is deliberately small. UPT's mailbox gets exactly two events: `admin_new_request` and `admin_response` — one concise mail per submitted answer, never one per item, never for admin-side status changes, analytics, expiry maintenance or payment (Shopify's own paid-order notification covers that). The customer gets `request_received`, `offer_ready` (which says UPT has responded and links to the offer, and must not claim payment is due before they have read it), and a single `confirmation` covering their whole answer — accepted and rejected items with prices and notes, the FedEx outcome, one checkout link when anything was accepted, and a plain "no payment needed" when nothing was. `checkout_link` survives only as the admin's manual recovery action on the request page.

`preview` and `failed` are different states with different causes: `preview` means no `RESEND_API_KEY`, so nothing was attempted; `failed` means Resend refused the send — a 403 for an unverified `EMAIL_FROM` domain is the likely first one. Do not describe an unverified domain as leaving messages in `preview`.

Nothing is lost once a send fails:

- `queueEmail` retries an existing row whose status is anything but `sent`, so the `(shop, idempotencyKey)` dedup no longer makes one lost message permanent.
- `runOfferMaintenance` sweeps `queued` / `failed` / `preview` rows oldest-first, bounded per run and by `EmailMessage.attempts` (`MAX_DELIVERY_ATTEMPTS`), which is roughly a day of hourly retries.
- Every send carries `Idempotency-Key: EmailMessage.id`, which Resend honours for 24 hours, so a retry after a lost reply cannot put a second copy in the customer's inbox. Resend's own message id is stored in `providerMessageId`.
- The Resend `fetch` has a 10 second `AbortSignal.timeout`. Without it a hung `api.resend.com` held the customer's own form POST open for the whole retry loop, for a plant request that was already committed.
- The admin request detail page renders the outbox for the request with a per-message retry, a resend for the offer-ready email, and a "Resend payment link / confirmation email" recovery action (shown only after a live Shopify invoice miss). `bodyText` is deliberately not sent to the browser: it contains payment links.

The expiration reminder goes only to customers who either never answered or accepted something — never to one who rejected every plant — and an accepted-but-unpaid reminder leads with the recorded `DraftOrderReference.invoiceUrl` rather than inviting them to review an offer they already answered.

Customer-facing links in emails are storefront proxy URLs
(`https://{shop}/apps/plant-requests/...`) built by `customerLinksForShop`. A link
to the app's own origin carries no signed identity and renders "Request not
available", so **never** hand a customer a `{appUrl}/customer/...` link.

### Payment webhooks

`POST /webhooks/orders/paid` closes the matching request and marks accepted items Sold. Lookup understands `REQ123` and legacy `UPT-REQ-YYYY-NNNNNN`. A redelivery for an already-paid request is ignored rather than appending a duplicate status event, and every non-match is logged with the order label.

### Expiration logic

`expireOverdueOffers(shop)` flips Pending unpaid requests to Expired when `offer.expiresAt` has passed. Invoked from request loaders and analytics, **and** from the scheduler. Each request is claimed with a conditional update, so the several sweeps a single page load starts cannot each write their own expiry event.

Expiry releases the plants for EXACT PLANTS review. `voidExpiredDraftOrders`
then deletes the unpaid Shopify draft order so the issued invoice 404s
("This invoice is not available"). `expireOverdueOffers` stays a database-only
claim; the Shopify delete runs from the hourly sweep and from the customer or
admin loader that first notices the hold has ended. A `COMPLETED` draft is
never deleted — a live store accepts that delete and would drop the admin
record of a payment that just landed. If `orders/paid` arrives after a void,
the payment is still recorded and the request is Closed, with a
**Payment After Expiration/Void** event and one admin email.

### App proxy pages never hydrate — build them as plain HTML

A page served through the app proxy is fetched by Shopify and rendered on the
storefront, so its `/assets/...` URLs resolve against the **shop's** domain and
the client bundle never loads. App-proxy customer responses use
`Content-Type: application/liquid` and a document fragment (not a full HTML
page) so Shopify injects the shop theme — header, menu, footer — around the
portal. The portal does **not** render its own Home / My Requests bar on
proxy pages. That chrome exists only on the local `/customer` demo, which has
no theme. Anything that depends on React state is dead there, and the client
router is worse than useless: it rewrites form actions and links to the app's
own paths (`/customer/...`), which do not exist on the shop domain and return a
Shopify 404.

Rules for `app/routes/customer*`:

1. Use a plain `<form>`, never React Router's `<Form>`.
2. Every input the server reads must have a real `name` and `defaultValue`.
   Hidden inputs mirroring React state submit empty values.
3. Buttons that change the form must be `type="submit"` with an `intent`, not
   `onClick`.
4. Form actions and redirects must be storefront paths — use
   `portalFormAction()` / `portalHome()` / `customerPortalRelativeLinks()`.
5. **Never use React Router's `?index`.** React Router strips `index` from the
   request URL before a loader sees it, so Shopify signs a query string
   containing `index` that the app then verifies without it: the app proxy HMAC
   never matches and the visitor is treated as signed out. Post to a real route
   (`customer.submit.tsx`) instead.

6. **Prefer GET for anything that only changes the form's shape.** "Add another
   plant" and "Remove plant" submit the form with `formMethod="get"` to the
   portal path: the browser puts the typed values in the query string and the
   page re-renders with one more (or one fewer) row. This is a readability
   choice, not a workaround: those round-trips carry no side effects, so a URL
   the customer can reload is the right shape for them.
7. Signed-out storefront pages use a real `<a href>` to
   `/customer_authentication/login?return_to=` with a **relative**
   `/apps/plant-requests` path (or `/apps/plant-requests/requests/:id` on a
   request they opened while logged out). Shopify rejects a full URL. Never
   point this at the app origin. The local `/customer` demo keeps the
   demo-login form and does not render this button.

`app/lib/customer-portal.test.ts` enforces 1–7 for the request form.

#### Why proxied POSTs used to return "Bad Request"

React Router **7.12** added a cross-origin check that rejects a form submission
whose `Origin` header does not match the host in `request.url`, and the app
proxy always produces that mismatch: the customer's page is on the shop's
domain, Shopify forwards the request to `upt-plant-request-portal.onrender.com`,
and the storefront `Origin` comes along with it. The check runs in
`handleDocumentRequest` **before any route**, so the reply was a bare
`Bad Request` with nothing in it — no route, no shop, no signature, and the same
body for every cause. `package.json` allows `^7.12.0` and there is no committed
lockfile, so the app started failing the moment a rebuild resolved 7.12 or later,
without a code change.

React Router's own escape hatch, `allowedActionOrigins`, is a build-wide static
list. It cannot say "this shop's storefront", and widening it would relax the
same check for `/app/*`, where the merchant's session cookie is precisely what
cross-site protection exists for. So:

- `server.js` (this is why the app no longer uses `react-router-serve`) moves the
  `Origin` header of a **signed** mutation aimed at `/customer` into
  `x-shopify-app-proxy-origin`, and strips that header from every inbound
  request first so a caller cannot pick the origin the app will check.
- `forwardedOriginIsTrusted` in `app/lib/customer-session.server.ts` then
  requires the withheld origin to be a storefront host of the **signed** shop,
  which is a check only the app can make. Shopify signs whatever it proxies,
  including a cross-site post aimed at the storefront, so the signature alone
  cannot tell a customer's own submission from a forged one — the origin can.
- `storefrontHostsForShop` (`app/lib/shop-domains.server.ts`) is that host list:
  the shop's `.myshopify.com` domain always, plus `shop.primaryDomain.host` from
  the Admin API, cached for an hour. The primary domain matters because a live
  store serves the proxy page on its **custom** domain, so the origin will not
  equal the signed `shop`. `APP_PROXY_STOREFRONT_ORIGINS` (comma separated) is
  the escape hatch when the Admin API cannot be asked yet.

A refused origin is logged with the shop and the hosts that were expected, so
this failure can never again present as an unexplained `Bad Request`.

Do not "fix" a future proxy 400 by widening `allowedActionOrigins`, and do not
route customer writes through GET to dodge the check.

`write_app_proxy` is in the scope list because configuring an app proxy requires
it. It was missing, which is a plausible contributor to proxy misbehaviour;
adding it means the merchant has to approve the scopes again.

#### The offer response follows the same rules

`app/components/customer-offer-view.tsx` has had the same treatment.
Accept/Reject are native radios named `choice-<sourceItemId>` inside the one
submitting form; FedEx is a real checkbox whose unchecked state submits nothing,
which is exactly "upgrade removed". The form posts to
`/apps/plant-requests/requests/:id`.

Removing FedEx is a **two-step server round-trip**: the first submit returns
`pendingFedexRemoval`, which renders the Settings warning with "Remove it and
continue" / "Keep the upgrade" and carries the choices forward as hidden inputs.
Nothing is recorded until the customer chooses. The JS modal it replaced never
opened on the storefront.

`readOfferChoices` only honours `accept` and `reject`; `unavailable` is always
derived from the offer, so a forged field cannot make an unavailable plant
purchasable.

**Nothing is pre-selected.** Every available plant needs a deliberate Accept or
Reject: the radios carry `required`, and — because that only binds a real
browser — `handleCustomerOfferAction` refuses a submission that leaves any
available plant unanswered, naming each one, rather than defaulting to `accept`.
Do not reintroduce a default; a pre-checked Accept turns an unread offer into a
purchase for anyone who just presses Submit.

The component holds **no client state at all**. Every photo the offer froze is
rendered as a plain `<img>`; a lightbox behind a click handler showed the
storefront customer only the first photo of the plant they were buying.

The page also has to stop offering what it cannot deliver:

- Past `offer.expiresAtIso` it renders an expired state — no countdown, no
  "reserved for you", no radios, no Submit. The hold, not the stored status,
  decides this: the expiry sweep may not have run, and the moment the hold ends
  the plant is an EXACT PLANTS candidate for public sale.
- A **closed** request never shows a checkout link, and a paid one confirms the
  payment instead (`requestPaid` / `paidAt` from `loadCustomerOfferPage`).
- An answer that left nothing payable always has a **Close Request** action,
  whether the customer rejected everything or UPT had nothing available. The
  admin request page offers the same action through `closeDeclinedRequest`,
  which refuses while anything is accepted and creates no draft order.
- A customer who accepted nothing still opens the request and reads the frozen
  offer back: plant name, the price and customer-facing notes they were shown,
  the exact offer photos, and their Declined decision — with no checkout link,
  no payment control and FedEx not shown as selected.
- The customer is never shown the confirmation email. The admin outbox on the
  request page is where queued mail is read.

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
- A proxied **write** must additionally come from a storefront of that signed shop (`forwardedOriginIsTrusted`). Shopify signs whatever it proxies, so the signature alone does not distinguish a customer's own submission from a cross-site one.
- `logged_in_customer_id` is resolved to a real name and email via the Admin API (`resolveCustomerIdentity`), cached in `CustomerProfile`. Without an email the portal treats the visitor as signed out rather than guessing.
- Unsigned requests to `/customer` return 404 in production.
- Local demo: cookie session, “Continue as logged in customer” → Alex Rivera (`alex.rivera@example.com`). Unavailable in production regardless of `ALLOW_CUSTOMER_DEMO_LOGIN`.
- Customers may only view their own requests.
- Admin demo bypass: `NODE_ENV !== production` and `SHOPIFY_API_KEY=devkey` → shop `DEV_SHOP` or `demo-shop.myshopify.com`. `assertProductionEnv` rejects `SHOPIFY_API_KEY=devkey` in production.
- `ensureShopSeeded` only runs under the dev bypass. **Do not call it from a production code path.**

### Analytics

Read from Prisma. Revenue uses `ShopifyOrderReference.plantRevenue` or draft line items filtered by `kind === "plant"` (FedEx excluded). Behavior flags and item conversion are computed from real request/response/payment data.

Every plant metric groups on `RequestItem.canonicalPlantId`, not on the typed
text and **never on the Shopify product title** — see "Canonical plant identity"
below. Each plant row carries the customer wordings that fed it so the owner can
audit a grouping. A product-title formatting difference is not a second plant.

The **Fulfilment Source** section splits the funnel by how each plant was to be
supplied, read from the offer snapshots so a plant counts on the route it was
actually offered on rather than whatever the request item says now. It reports
lines, offered, accepted, rejected, purchased and revenue per route, plus
requests filled from existing stock (counted **per request**, not per plant),
existing-stock acceptance and purchase rates, and Exact Plant against Grower's
Choice on offered-to-paid. FedEx is a shipping service and appears on no route.

### Canonical plant identity

Two names are kept for every line, permanently. `RequestItem.plantName` is the
customer's own wording and is never rewritten. `RequestItem.canonicalPlantId`
points at the identity the line is *counted* under.

`app/lib/plant-identity.ts` is pure and has no database or network access.
`canonicalPlantKey` folds case, whitespace, diacritics and punctuation, expands a
`H.` style genus abbreviation against the candidates already on file, and drops a
bare `sp.`. `comparePlantNames` returns a confidence tier:

| Tier | Reached by | Effect |
| --- | --- | --- |
| `high` | identical canonical keys, or a Levenshtein distance of 1 on the epithet | linked automatically |
| `medium` | distance 2 on the epithet, or an unambiguous abbreviation expansion that is not exact | **not** linked; a `PlantIdentitySuggestion` is opened |
| `low` | anything else | kept separate, silently |

Distance 1 covers the overwhelming majority of real typing errors (a dropped,
doubled, transposed or mistyped letter) and on botanical epithets almost never
collides with a different real epithet. Distance 2 is plausible but not safe
enough to merge unattended, so it becomes an admin question instead. Two further
guards, both exported constants with tests: `MIN_TYPO_WORD_LENGTH` is 6, so no
edit is forgiven in a short word — genus names are four or five letters, where one
edit is far more likely to be a different genus than a slip — and
`MAX_TYPO_DISTANCE_RATIO` is 0.25, so a run of edits may never consume more than a
quarter of the word. When a high-confidence match is ambiguous across several
candidates it is downgraded to medium rather than guessed at.

**Deliberately never merged automatically**, because a wrong merge silently
corrupts the owner's analytics and is worse than two rows: quoted names,
cultivars, accession numbers, clone numbers, collection numbers, seedling
numbers, collector codes and locality words. `parsePlantName` treats these as
qualifiers that are part of the identity, so `Hoya carnosa` and
`Hoya carnosa 'Krimson Queen'` stay separate no matter how similar the rest is.

The analytics page no longer shows a Plant Name Review card. High-confidence
matches still group automatically. Medium-confidence suggestions stay stored
and do not merge on their own.

Backfill: `backfillCanonicalPlants` resolves every `RequestItem` whose
`canonicalPlantId` is null, oldest request first so the earliest spelling becomes
the `displayName`. It is idempotent — a second run finds nothing to do — and runs
on demand from the analytics and behaviour paths, so no deploy-time step is
needed. New submissions get their identity in `submitCustomerRequest`.

### AI is an optional assist, off by default

`app/lib/plant-identity-ai.server.ts` defines `PlantIdentityProvider` with one
method, `suggestCanonicalPlant(name, candidates)`. The default export is
`disabledPlantIdentityProvider`, which always returns `null`; that is what CI and
production run today. **No provider is configured, and nothing requires one** —
the request, offer, draft-order and payment flows never consult it, and with it
absent the only thing lost is suggestion quality on names the deterministic rules
cannot reach.

A provider may only ever *suggest*. It is capped at `medium` confidence, so it can
never auto-link an identity, and it can never reserve inventory or create an offer.
A returned `canonicalPlantId` that is not one of the candidates that were passed in
is discarded, so an invented id cannot reach the database. A provider error is
logged and treated as "no suggestion".

To enable one later, set **all four** of these on the Render web service (Render
dashboard → `upt-plant-request-portal` → Environment). Any one of them missing and
`readPlantIdentityAiConfig` returns null, so the disabled provider is used and
nothing is sent anywhere:

| Variable | Meaning |
| --- | --- |
| `PLANT_IDENTITY_AI_PROVIDER` | Vendor label, e.g. `openai`, `anthropic`, `together`, `ollama`. Recorded on the suggestion and shown in the admin status line |
| `PLANT_IDENTITY_AI_BASE_URL` | Base URL of an OpenAI-compatible chat-completions endpoint, e.g. `https://api.openai.com/v1` |
| `PLANT_IDENTITY_AI_MODEL` | Model id, e.g. `gpt-4o-mini`, `claude-sonnet-4-5`, `llama3.1:8b` |
| `PLANT_IDENTITY_AI_API_KEY` | Bearer token for that endpoint |

`PLANT_IDENTITY_AI_TIMEOUT_MS` is optional and defaults to 5000. The call happens
on an admin page load, so it is aborted rather than allowed to hold the page.

They are deliberately **not** in `render.yaml`: a `sync: false` entry would make
first deploy prompt for a credential that does not exist and that nothing needs.

The vendor is not hard-coded — naming a URL and a model rather than a company is
what keeps it open, and a provider with a different wire shape can be dropped in
by implementing `PlantIdentityProvider`. The analytics page prints whether AI is
on and, when off, exactly which variables would turn it on.

### Help / Ask UPT Portal

`/app/help` is an **admin-only** page that answers questions about how this app
works — statuses, derived labels, behaviour flags, the conversion percentages,
the fulfilment routes and the EXACT PLANTS workflow. `requireAdmin` gates both
the loader and the action, and `app/lib/help-assistant.test.ts` asserts that no
customer route or component references the help modules and that nothing outside
an `app.*` route reaches them, in the same spirit as the behaviour-flag scan.

The content is `app/lib/help-glossary.ts` (terms) and `app/lib/help-topics.ts`
(workflows). It lives **in code, not in the database and not read from Markdown
at runtime**: the Dockerfile copies `build`, `prisma`, `scripts`, `public` and
`server.js` and no Markdown at all, so an assistant that read `AGENTS.md` at
runtime would find nothing in production.

Every entry carries citations — a repo path, a locator and a quote.
`app/lib/help-content.test.ts` reads each cited file and fails when a quote is no
longer in it, and where the behaviour is computed it calls the function and
asserts the answer the glossary gives. That is what stops an entry describing a
rule the code has since replaced. **Changing a business rule means the glossary
entry citing it fails until it is updated.**

`app/lib/help-retrieval.ts` is pure: no database, no network, no AI. It matches
glossary terms and aliases exactly and within one edit per long word, and
otherwise ranks passages by IDF-weighted overlap. It refuses unless the question
either names a term or is largely accounted for by one passage that the question
*names the subject of*. Two guards keep it honest:

- a one-word alias more than half the passages use cannot pick an entry — every
  passage talks about offering something, so "can we offer net-30 terms?" is not
  a question about the `offered` item status. An entry's own **title** is exempt,
  so `Expired` still works.
- word overlap alone is not enough. "Can a customer change their shipping
  address after paying?" is mostly words the Draft order entry uses, and that
  entry does not say whether an address can be changed, so it is refused.

Refusing is the intended outcome for anything undocumented; the refusal names
the nearest entries rather than answering from them. `answerPortalQuestion` takes
an optional `HelpRequestContext` (request number, status, derived customer label,
whether anything is payable, the hold deadline, the fulfilment routes) which
boosts the ordering of the entries that state applies to. It **cannot** turn a
refusal into an answer, and per-request answers are not implemented yet — the
seam exists so "why is REQ123 Pending?" does not need the answer path rebuilt.

AI is optional here too and off by default, configured exactly like plant
identity: `HELP_ASSISTANT_AI_PROVIDER`, `HELP_ASSISTANT_AI_BASE_URL`,
`HELP_ASSISTANT_AI_MODEL` and `HELP_ASSISTANT_AI_API_KEY`, all four required
together, plus an optional `HELP_ASSISTANT_AI_TIMEOUT_MS` defaulting to 8000.
`app/lib/ai-provider.server.ts` holds the configuration contract and the request
shared with plant identity. A provider may only reword and choose between the
passages it was handed: a returned id that was not supplied is discarded, a reply
naming none of them is treated as no reply, and the passage's citations are shown
beside whatever wording comes back. A question that scored nothing is refused
before any provider is called. Absence, failure and timeout are all
indistinguishable from "no improvement".

### Internal behaviour flags

`app/lib/plant-behavior.ts` adds the **Repeated Request / Decline Pattern** flag,
computed per canonical plant: times requested, offered, declined, purchased, the
span in days and the most recent request date. It fires at **3+ requests of one
canonical plant within 90 days, 0 purchases of it, and 2+ declines** — three
requests is the first count that is a pattern rather than a coincidence, 90 days
matches the existing analytics window, and requiring two declines plus zero
purchases means the customer has actually turned the plant down rather than
simply not answered yet.

Grouping by canonical identity is the point: four differently spelled requests
for the same plant read as a pattern, where raw text would read as four
unrelated plants.

This is **internal insight only**. It appears in Customer Behavior Analytics and
on the admin request detail page, never in a customer-facing route, and it never
blocks or gates anything a customer can do. `app/lib/plant-behavior.test.ts`
asserts that no customer route or component references the flag or its module.

### Search

Admin dashboard `matchesAdminSearch` matches customer, email, stored and displayed request numbers, plant name, offered name.

---

## Tests / build / typecheck results

Last verified on `cursor/post-dev-store-corrections-9639`, the branch carrying all four phases of this pass:

| Check | Result |
| --- | --- |
| `npm test` | 652 passing, against **both** SQLite and PostgreSQL 16. `pretest` regenerates the Prisma client, so switching `DATABASE_URL` needs no manual step |
| `npm run typecheck` | pass (`react-router typegen && tsc --noEmit`) |
| `npm run lint` | pass |
| `npm run prisma:validate` | pass (both schemas) |
| `npm run prisma:check-schema` | pass |
| `npm run validate-graphql` | pass (documents + variable payloads against live Admin `2026-04`, including Exact Plant `inventorySetQuantities` with `changeFromQuantity` and a `DraftOrderInput` that sells a real `variantId` and carries `reserveInventoryUntil`) |
| `npm run build` | pass |
| `docker build` + boot on PostgreSQL | pass; migrations applied, `/healthz` 200, container reports `healthy` |
| GitHub CI (`.github/workflows/ci.yml`) | typecheck → lint → both schemas validated → schema-sync check → **tests on SQLite** → **tests on PostgreSQL** → build |

Also verified in the Cloud VM: the app-proxy authorization boundary (a signed
request per customer sees only its own requests; unsigned, replayed, tampered and
wrong-secret requests see nothing), the scheduler expiring an offer and sending
exactly one reminder, and the production env guard refusing to boot on six
misconfigurations.

The dev store `upt-plant-request-dev.myshopify.com` now has the app installed
with a live offline session, so the Admin API is reachable and the whole
workflow can be driven against it — see "Verifying against the dev store"
above. What that has confirmed so far: the granted scope list, the publication
handles, the shop's currency and weight unit, and that the app proxy, customer
identity resolution and offline token refresh all work end to end.

**Both Render services should auto-deploy `main`** (`render.yaml` now sets
`branch: main` and `autoDeployTrigger: checksPass`). If the dashboard still
tracks `cursor/production-readiness-blockers-7617`, sync the Blueprint —
"Deploy latest commit" is not the intended steady state. See
[AUTOMATED_DELIVERY.md](AUTOMATED_DELIVERY.md). Do not build a second deploy
system. Never deploy smoke or destructive tests at the live UPT store.

---

## Known issues

- Headless Cloud VM cannot run `shopify app dev` (needs Partner login + tunnel).
- Demo listing products are not real Shopify products; GID looks like `gid://shopify/Product/upt-{itemId}`.
- `shopify.app.toml` carries the production Render URLs, committed because Shopify's TOML cannot read environment variables. `app/lib/shopify-config.test.ts` guards them. **Do not run `shopify app dev` against the production app** — use `shopify app config use dev` (`shopify.app.dev.toml`, separate development app), or the React Router dev server, which needs no Shopify app at all.
- Custom draft-order plant lines do not set `requiresShipping`. Shopify does not document its default and it cannot be tested without a live store, so setting it would be guessing at checkout behaviour. Confirm shipping rates appear at checkout during the live draft-order test and set it then if they do not.
- Whether Shopify actually **grants** the `reserveInventoryUntil` hold, and whether it releases at exactly that moment, cannot be verified without a store. The code reads the granted deadline back rather than assuming it and records a `fulfillmentIssue` when nothing came back, so an ungranted hold is visible instead of silent. The experiment that settles it: link a variant with one unit, accept it, then in the Shopify admin confirm the variant reads one committed/unavailable unit and zero available; leave the offer unpaid past its deadline and confirm the unit returns to available; then repeat and pay, and confirm the paid order deducts it once and no second unit is held.
- Whether Shopify reports an exhausted hold as a `draftOrderCreate` user error at all, and in what words, is unverified. `isInventoryUserError` matches on `inventor|stock|out of stock|unavailable quantity`; a store that phrases it otherwise would surface the refusal as a generic Shopify failure rather than a named stock problem. The order is still not created either way, so this is a message-quality risk and not an oversell risk. Capture the exact `userErrors.message` during the live test and tighten the match to it.
- The CLA workflow was deleted on the production-readiness branch, but it is a `pull_request_target` workflow, which GitHub always runs from the **base** branch. It therefore keeps failing on PR #24 until that deletion is merged to `main`, and disappears for PRs opened afterwards.
- Unused localStorage prototype modules remain in `app/lib/` and can confuse agents; they are not the live data layer.
- `RequestNumberSequence.year` is a leftover of the old yearly scheme; do not reintroduce `UPT-REQ-YYYY-000001`.
- Existing local DBs may still contain leftover `UPT-REQ-2026-000008` / `000009` rows from earlier demos; display maps those to `REQ8` / `REQ9`. Official seeds remap `UPT-REQ-2026-000001`–`000007` and `000099` → `REQ1`–`REQ8`.
- No committed lockfile; `.npmrc` `engine-strict=true` (Node `>=20.19 <22 || >=22.12`). The Dockerfile pins Node 22 for this reason.
- SQLite file is local/ephemeral in Cloud VMs unless the environment snapshot includes it. Production must use PostgreSQL; the app refuses to boot otherwise.

---

## Required live dev-store verification

**Grower's Choice inventory reservation has been observed on the dev store.**
Shopify grants it as **reserved**, not committed: after accept, available=0 and
reserved=1, and `DraftOrderReference.reserveInventoryUntil` equals
`offer.expiresAt`. The 2025-10 schema's `committed` wording is not what this
store reports. Do not offer Grower's Choice on the real UPT store until that
shop has approved `write_inventory` and the remaining runbook account actions.

Recorded facts that contradict the docs or a naive reading of the schema:

- A second `draftOrderCreate` on a 1-unit already-reserved variant is **not**
  refused. Reserved goes to 2 and available goes to **-1**. The app pre-check
  (`assertLinkedStockStillAvailable` / `reservationShortfalls`) is the real
  oversell guard; do not rely on `isInventoryUserError`.
- `draftOrderDelete` releases that draft's reserved quantity immediately
  (reserved 1→0). It also succeeds on a `COMPLETED` draft and does **not** undo
  the Order — skip COMPLETED or the admin draft record disappears.
- A deleted invoice URL returns HTTP 404, title "This invoice is not available".

Run them on `upt-plant-request-dev.myshopify.com`. Each says what to look at.

1. **The reservation is granted.** *Observed on REQ5, Probe A
   (`gid://shopify/ProductVariant/44937080307755`).* After accept: available=0,
   reserved=1, `reserveInventoryUntil` = `offer.expiresAt`, no `fulfillmentIssue`.
   Shopify admin will not show "1 committed".
2. **The reservation releases at expiry.** Shopify still lapses the hold at
   `reserveInventoryUntil` if the portal is down. With the void shipped, deleting
   the draft releases reserved immediately — REQ5 went available=1 reserved=0
   the moment the invoice was voided, before the original 2026-08-25 deadline.
3. **A stale invoice cannot be paid after expiry.** *Implemented and
   re-verified on REQ5, 2026-08-22.* After the portal expired the hold,
   `voidExpiredDraftOrders` deleted draft `#D9`. Shopify then returned
   `draftOrder: null`, inventory **available=1 reserved=0**, and the stored
   invoice URL answered HTTP 404 titled "This invoice is not available". The
   customer page said Offer Expired, dropped the checkout link, and did not
   claim the plants were still held. Before the void shipped, the same store
   still completed a stale draft (`draftOrderComplete` created order #1002 and
   took inventory again) — that is why the delete exists.
4. **Insufficient inventory fails safely.** *Observed on REQ7.* Zeroing Probe D
   after the offer was sent, then accepting, created **no** draft order. The
   admin banner named the plant: "GC Probe D: only 0 of the 1 needed is left in
   stock." Shopify never returned a `draftOrderCreate` userError — the app
   pre-check refused first. `isInventoryUserError` was not tightened because
   there is no verbatim Shopify wording on this store.

Also still unobserved on a live store, from earlier passes: EXACT PLANTS
publishing end to end on the **real** UPT shop (the dev store's offline session
now includes `write_inventory`), Shopify Files uploads at scale, and a real
`orders/paid` from an actual checkout rather than a self-signed webhook.

---

## Unfinished work

Owner decision 2 (void the expired unpaid invoice) is on `main` via PR #31.
Routine delivery (auto-merge, Render `main`, `/versionz`, Playwright) and the
EXACT PLANTS sortable table live on `cursor/auto-merge-exact-plants-table-5eef`.
That PR is **high-risk** and must not auto-merge. Everything else left needs
an account action, a hosting decision, or a live store —
enumerated with exact screens in
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) and in the verification
list above.

Phase 4 UI polish is presentational only: admin photo reorder posts a whole
id list (`intent=reorder-photos`) with Move left/right as the no-JS fallback;
metric cards, fulfilment buttons, price/weight, stock search and the dashboard
table wrap below 720px; customer offer images and Accept/Reject/FedEx hit areas
fit a 375px viewport without hydration. Stored statuses, eligibility rules and
computed numbers did not change.

One analytics correctness bug is **reported, not silently "fixed"**: the
customer table, the item-conversion table and the revenue-this/last-month cards
read `allShopRequests` and therefore ignore the Date Range picker. The ranged
`requests` query already exists beside it. Treat that as its own change.

**Done:** the Render Blueprint is applied and the web service is live at
`https://upt-plant-request-portal.onrender.com`, verified from outside —
`/healthz` 200, unsigned `/customer` 404, `/cron/offer-maintenance` 401 (so
`CRON_SECRET` is set). `shopify.app.toml` carries the production URLs.

Remaining, all on the owner:

1. `shopify app deploy`, then approve the scopes in the store admin. This is
   what grants **`write_inventory`**, and every EXACT PLANTS listing approval
   fails at the inventory step until it lands. It fails safely — the product is
   created but stays unpublished and the listing records the error — but the
   workflow cannot be finished. The app uses Shopify managed installation, so
   editing `shopify.app.toml` alone changes nothing until it is deployed.
2. Turn off **"automatically publish new products"** on the Microsoft Copilot
   sales channel. Shopify puts every new product there a second after creation,
   attributed to no app, and `publishableUnpublish` accepts that channel's id,
   returns no error and leaves the product published. The app cannot revoke it;
   it names the channel in the log instead. Until this is off, every EXACT
   PLANTS listing — one physical plant — sits on a channel where it can be sold
   again.
3. Confirm the FedEx listing SKU `UPTUPGTOFED1236S` on the real store (runbook
   §7). The app resolves that SKU first. The dev store has no product at that
   SKU or the fallback handle, so the variant-priced FedEx line has never run
   against a real variant.
4. Database backups (runbook §6) — Render point-in-time recovery is already on
   for this plan, so this is confirming retention, not enabling it: 3 days on
   Hobby, 7 on Pro. It has already been used once to recover this database.
5. Optionally, AI keys. Everything works without them; see "AI is an optional
   assist, off by default".

Both cron and Resend are confirmed working: the hourly job has been observed
succeeding against the deployed service, and Resend accepted every message sent
from the dev store with a verified sending domain.

Nothing else is blocked on an agent.

Genuinely optional, deliberately not done:

- Customer Account OAuth. Not needed: the app-proxy flow now yields a verified
  customer id plus a real name and email from the Admin API.
- Retiring the unused `sample-*` / localStorage modules. No active route imports
  them; deleting them is cosmetic and would add review noise here.

---

## Business decisions taken by the owner

These were decided by the shop owner, not inferred. Do not reverse either
without asking; both concern which plant is for sale and who may pay for it.

### 1. A declined exact plant stays listable after the request is closed

*Implemented.*

`exactPlantReleaseReason` used to refuse any `Closed` request, so an admin
closing a request whose customer had declined everything dropped exactly the
plants the review queue exists for. `Closed` means one of two different things —
paid, or closed because there was nothing to pay for — and only the first puts a
plant out of reach. **Payment decides eligibility, not the bare status.** The
`paidAt` check already sits a line earlier, so removing the status check lost
nothing else.

Without this, the Close Request action and rule 9 contradict each other and an
admin has to remember to list before closing.

### 2. An expired unpaid hold must make its invoice unpayable

*Implemented.* Verified on `upt-plant-request-dev` against REQ5 (draft
`gid://shopify/DraftOrder/1172817248299`).

Shopify has no draft-order void. `draftOrderDelete` is the accepted form of
"unpayable": the checkout URL then 404s and that draft's reserved quantity
returns immediately. The portal keeps the GID, invoice URL, line items and
`voidedAt` on `DraftOrderReference`.

`expireOverdueOffers` stays a database-only claim so a page load cannot stall
on Shopify. `voidExpiredDraftOrders` runs after it on the hourly sweep, and
from the customer/admin loader that first sees the hold has ended — waiting a
full hour would leave a payable invoice after the plant is released.

A live store will delete a `COMPLETED` draft without undoing the Order. The
sweep re-reads status immediately before deleting and skips `COMPLETED`,
recording `completed_before_void` so it is never retried.

`orders/paid` after a void is never ignored: the payment is recorded, the
request is Closed, EXACT PLANTS eligibility drops (paid), a distinct
**Payment After Expiration/Void** event is written, the admin request page
shows a critical banner, and one admin email is sent.

---

## Business rules future agents must preserve

1. **Do not rebuild** the portal. Extend the Prisma-backed React Router app.
2. Request statuses stored: **New / Pending / Closed / Expired**. Customer display is derived by `formatCustomerStatusLabel` from the stored status plus `hasPayableItems` (`offerHasPayableItems`) and `hasResponded`: Pending and unanswered → **Offer Ready for Review**; Pending and answered with something payable → **Needs Payment**; nothing payable → **No Payment Needed**. Fix the label, never the stored status.
2a. What an item must carry to be offered depends on its fulfilment route. `incompleteOfferItems` names each item and its missing fields; `sendOffer` is the authority and throws `OfferIncompleteError`. An **exact plant** needs at least one exact plant photo, a price and a weight. A **Grower's Choice** item needs a linked purchasable variant with enough stock, a price and a weight — the linked variant's own weight where it has one — and **no exact photo**, there being no one plant to photograph. **Not Available** needs none of it. Customer-facing notes stay optional throughout.
3. Customer form: plant name required; notes optional; **no quantity UI**; quantity defaults to 1. **Budget stays out** of the form, customer-facing details, and active workflow. Do not drop `RequestItem.budget` unless a migration is actually required.
4. Name/email come from the customer account when possible. Customers see only their own requests.
5. Offer snapshots freeze name, price, photos, notes, availability, fulfilment route and the linked product/variant titles after send. Do not edit customer-facing offer fields after send, and never re-read them from Shopify: a merchant renaming or repricing the product must not rewrite what the customer answered or what they are billed.
6. FedEx upgrade is a separate product, checked by default, warning from Settings, **excluded from plant analytics**. Never create an EXACT PLANTS listing for FedEx.
7. Draft orders only for **accepted** plants (plus FedEx if selected). A Grower's Choice line sells the real Shopify `variantId`, never a custom line item; an exact plant has no product in Shopify yet and stays custom.
7a. Linking a listing reserves nothing. Stock is held only when the customer accepts and the draft order is created, only through `DraftOrderInput.reserveInventoryUntil`, and only until the offer's own payment deadline. Never oversell and never silently drop an item: if the stock has gone, create nothing and tell the admin which plant. Every inventory operation stays idempotent — a recorded reference, the Shopify tag lookup and the creation claim are all load-bearing.
8. Payment (`orders/paid`) → Closed. Unpaid hold end → Expired.
9. **Declined item** means: UPT marked Available, UPT created an **exact-plant** offer, customer was given Accept/Reject, customer chose **Reject**. This is **not** UPT Not Available, and it is **not** a rejected Grower's Choice item — that plant already has its own Shopify product, and an EXACT PLANTS listing is one physical plant with one unit of tracked stock.
9a. An **expired unpaid offer** releases its Available plants too, by the same admin-approved path. `exactPlantReleaseReason` is the single rule and keeps historical reasons distinct: `customer_declined`, `accepted_unpaid_expired`, `never_responded_expired`, and `unclaimed_after_close` when a request closed with the plant still unclaimed (admin override before a response, or customer Close Request after decline-all). Do not rewrite admin override or customer close as a customer decline. A plant is only ever released when it is promised to nobody — never while a hold is live, never for UPT Not Available, never for Grower's Choice, never once the request is **paid**, and never after `exactPlantDismissedAt`. Being `Closed` is not itself disqualifying: see decision 1 below.
10. **Never auto-publish declined items.** Save the rejection; wait for admin review + explicit approve.
10a. **Dismiss from EXACT PLANTS** is an admin queue action for an eligible, not-yet-listed plant. Confirmation is required. It does not create or delete a Shopify product, and it does not delete the request, customer response, offer snapshot, photos or history. `exactPlantDismissedAt` plus a StatusEvent reason `Admin Dismissed from EXACT PLANTS` keep the item out of later queue refreshes. If a product GID already exists, this action must refuse.
11. Listing prefill/publish: title, price, weight, selected exact-plant photos only. Exclude customer-facing notes/disclaimers, customer identity, request information, and customer response information.
12. One Shopify product per declined item. Retries/refreshes/repeated response processing must not duplicate. On failure, keep the rejection and allow idempotent retry.
13. Do not create EXACT PLANTS listings for accepted items, UPT Not Available items, never-offered items, or FedEx.
14. Publish listings only to **Online Store** and **POS**, and add them to the existing **EXACT PLANTS** collection.
15. Request numbers are `REQ1`, `REQ2`, `REQ2178` — sequential, unpadded, shop-wide.
16. A plant has **two** names and keeps both. Never overwrite `RequestItem.plantName` with a normalised form, and never show a customer the canonical identity. Analytics group on the canonical identity; the customer's wording is what the customer sees.
17. Only high confidence links two spellings automatically. Medium opens an admin suggestion and merges nothing. Quoted names, cultivars, accession/clone/collection/seedling numbers, collector codes and localities are never merged automatically — a wrong merge corrupts analytics invisibly, and two rows for one plant is the cheaper mistake.
18. AI is optional and off. It may only suggest, capped at medium confidence, and must never auto-link an identity, reserve inventory or create an offer. No core flow may come to depend on it.
19. Behaviour flags are **internal**. They must never reach a customer-facing route and must never block a customer.

---

## iOS admin app

A dedicated iPhone client for the **same** portal — not a second inventory
system and not a Shopify-free subset. The phone talks only to this app on
Render. Render keeps using the existing Shopify offline session for draft
orders, stock search, Files, reservations, and EXACT PLANTS listings. The
iOS app must not embed Admin API credentials or write inventory itself.

Business rules stay the ones in this handoff (statuses, FedEx, one-unit
Exact Plants, declined-item review, etc.). A phone action that sends an
offer or stocks a plant must call the same `portal.server` /
`shopify-ops.server` functions the web admin already uses.

Auth: tokens are created in **Settings → iOS admin app**. Only a SHA-256
hash is stored (`AdminMobileToken`). Revoke cuts off a lost phone. The
phone sends `Authorization: Bearer upt_admin_…`. Do not put a mobile token
in `LOGGABLE_PARAMS`.

The Expo app lives in `mobile/ios-admin/`. It is **not** part of the web
`tsc` / ESLint / CI matrix. Run it with Expo Go (`npx expo start`).

**Shipped (first slice):** `GET /api/mobile/admin/session`, request list,
request detail. Read-only browse.

**Still to port, same Shopify-backed backend:** request item edit (exact
plant / link website stock / not available), photos, send offer, close
request, EXACT PLANTS review/list, settings. **Analytics stays web-only**
— do not add it to the iPhone app. Visual redesign of the iOS client is
allowed and expected; it must not change stored statuses, Shopify writes,
or business rules. Do not invent a parallel fulfilment path to get
actions onto the phone faster.

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
| `app/lib/growers-choice.ts` | Fulfilment routes, linkable-variant rules, stock search query, hold state. Pure and **import-free** on purpose |
| `app/lib/shopify-ops.server.ts` | Draft orders + inventory reservation, stock search, Files, product/collection/publish |
| `app/lib/offer-response.server.ts` | Customer accept/reject + draft-order trigger |
| `app/lib/emails.server.ts` | Outbox + Resend |
| `app/lib/analytics.server.ts` | Dashboard analytics |
| `app/lib/plant-identity.ts` | Pure normaliser + confidence tiers. No database, no network |
| `app/lib/plant-identity.server.ts` | Identity resolution, aliases, suggestion confirm/reject, idempotent backfill |
| `app/lib/plant-identity-ai.server.ts` | Optional AI provider interface; disabled by default |
| `app/lib/plant-behavior.ts` / `plant-behavior.server.ts` | Per-canonical-plant behaviour patterns (admin-only) |
| `app/lib/seed-demo.server.ts` | Demo seed + legacy number remap |
| `app/lib/admin-auth.server.ts` / `shop.ts` | Admin auth + demo bypass |
| `app/lib/admin-mobile-auth.server.ts` | iOS device-token create / verify / revoke |
| `app/lib/admin-mobile-api.ts` | iOS list/detail payloads |
| `mobile/ios-admin/` | Expo iPhone admin app (first slice) |
| `app/lib/customer-session.server.ts` | Customer cookie / proxy identity, including the storefront origin check |
| `app/lib/shop-domains.server.ts` | Storefront hostnames a proxied submission may come from |
| `server.js` | Production server. Replaces `react-router-serve` only to hand the app-proxy `Origin` to the app |
| `app/routes/app.*.tsx` | Admin UI |
| `app/routes/customer*.tsx` | Customer portal |
| `app/routes/webhooks.orders.paid.tsx` | Payment close |
| `shopify.app.toml` | Scopes, webhooks, app proxy |
| `render.yaml` | Render Blueprint: PostgreSQL, web service, cron job. Checked against the app by `app/lib/render-blueprint.test.ts` |
| `scripts/run-offer-maintenance.mjs` | Render cron job entry point |
| `scripts/prisma.mjs` | Prisma CLI wrapper; picks the schema from `DATABASE_URL` |
| `scripts/validate-admin-graphql.mjs` | Validates Shopify calls against the live Admin schema |
