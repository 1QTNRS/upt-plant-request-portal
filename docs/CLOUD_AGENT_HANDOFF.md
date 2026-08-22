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
| `inventorySetQuantities` takes quantities | On 2025-10 it also **requires** `ignoreCompareQuantity`, which is deprecated ahead of the 2026-01 redesign — and deprecated input fields are hidden from a default introspection, so the validator could not see it until it was told to ask |

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
`inventoryActivate` when it does not. On `2025-10`, `inventorySetQuantities`
still requires the deprecated `ignoreCompareQuantity` (or a `compareQuantity` on
every entry); its replacement, `InventoryQuantityInput.changeFromQuantity`, only
exists from `2026-01`. Revisit `buildExactPlantInventoryInput` when the API
version is bumped.

### Emails

Queued in `EmailMessage`. Delivered through Resend when `RESEND_API_KEY` is set; otherwise status `preview` (and production logs a warning per undelivered message). Templates exist for received, admin notify, offer ready, confirmation, checkout, expiration reminder, plus `compliance_data_request`.

`preview` and `failed` are different states with different causes: `preview` means no `RESEND_API_KEY`, so nothing was attempted; `failed` means Resend refused the send — a 403 for an unverified `EMAIL_FROM` domain is the likely first one. Do not describe an unverified domain as leaving messages in `preview`.

Nothing is lost once a send fails:

- `queueEmail` retries an existing row whose status is anything but `sent`, so the `(shop, idempotencyKey)` dedup no longer makes one lost message permanent.
- `runOfferMaintenance` sweeps `queued` / `failed` / `preview` rows oldest-first, bounded per run and by `EmailMessage.attempts` (`MAX_DELIVERY_ATTEMPTS`), which is roughly a day of hourly retries.
- Every send carries `Idempotency-Key: EmailMessage.id`, which Resend honours for 24 hours, so a retry after a lost reply cannot put a second copy in the customer's inbox. Resend's own message id is stored in `providerMessageId`.
- The Resend `fetch` has a 10 second `AbortSignal.timeout`. Without it a hung `api.resend.com` held the customer's own form POST open for the whole retry loop, for a plant request that was already committed.
- The admin request detail page renders the outbox for the request with a per-message retry, a resend for the offer-ready email, and a "create payment link and email it" action. `bodyText` is deliberately not sent to the browser: it contains payment links.

The expiration reminder goes only to customers who either never answered or accepted something — never to one who rejected every plant — and an accepted-but-unpaid reminder leads with the recorded `DraftOrderReference.invoiceUrl` rather than inviting them to review an offer they already answered.

Customer-facing links in emails are storefront proxy URLs
(`https://{shop}/apps/plant-requests/...`) built by `customerLinksForShop`. A link
to the app's own origin carries no signed identity and renders "Request not
available", so **never** hand a customer a `{appUrl}/customer/...` link.

### Payment webhooks

`POST /webhooks/orders/paid` closes the matching request and marks accepted items Sold. Lookup understands `REQ123` and legacy `UPT-REQ-YYYY-NNNNNN`. A redelivery for an already-paid request is ignored rather than appending a duplicate status event, and every non-match is logged with the order label.

### Expiration logic

`expireOverdueOffers(shop)` flips Pending unpaid requests to Expired when `offer.expiresAt` has passed. Invoked from request loaders and analytics, **and** from the scheduler.

### App proxy pages never hydrate — build them as plain HTML

A page served through the app proxy is fetched by Shopify and rendered on the
storefront, so its `/assets/...` URLs resolve against the **shop's** domain and
the client bundle never loads. Anything that depends on React state is dead
there, and the client router is worse than useless: it rewrites form actions and
links to the app's own paths (`/customer/...`), which do not exist on the shop
domain and return a Shopify 404.

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

`app/lib/customer-portal.test.ts` enforces 1–6 for the request form.

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
  whether the customer rejected everything or UPT had nothing available.
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

### Search

Admin dashboard `matchesAdminSearch` matches customer, email, stored and displayed request numbers, plant name, offered name.

---

## Tests / build / typecheck results

Last verified on `cursor/dev-store-verification-9639`:

| Check | Result |
| --- | --- |
| `npm test` | 307 passing, against **both** SQLite and PostgreSQL 16. `pretest` regenerates the Prisma client, so switching `DATABASE_URL` needs no manual step |
| `npm run typecheck` | pass (`react-router typegen && tsc --noEmit`) |
| `npm run lint` | pass |
| `npm run prisma:validate` | pass (both schemas) |
| `npm run prisma:check-schema` | pass |
| `npm run validate-graphql` | pass (23 documents + 10 variable payloads against live Admin `2025-10`) |
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

**Both Render services deploy from `cursor/production-readiness-blockers-7617`**
with `autoDeploy: yes`. Work on any other branch reaches the dev service only by
deploying a specific commit id through the API, and the next push to the tracked
branch replaces it. Merge before relying on anything being live.

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
2. Request statuses stored: **New / Pending / Closed / Expired**. Customer display: Pending → **Needs Payment** (label only), or **No Payment Needed** when the offer and the answer left nothing payable (`offerHasPayableItems`). Fix the label, never the stored status: closing a request whose customer rejected everything would take its declined plant out of the EXACT PLANTS queue.
3. Customer form: plant name required; notes optional; **no quantity UI**; quantity defaults to 1. **Budget stays out** of the form, customer-facing details, and active workflow. Do not drop `RequestItem.budget` unless a migration is actually required.
4. Name/email come from the customer account when possible. Customers see only their own requests.
5. Offer snapshots freeze name, price, photos, notes, availability after send. Do not edit customer-facing offer fields after send.
6. FedEx upgrade is a separate product, checked by default, warning from Settings, **excluded from plant analytics**. Never create an EXACT PLANTS listing for FedEx.
7. Draft orders only for **accepted** exact plants (plus FedEx if selected).
8. Payment (`orders/paid`) → Closed. Unpaid hold end → Expired.
9. **Declined item** means: UPT marked Available, UPT created an exact-plant offer, customer was given Accept/Reject, customer chose **Reject**. This is **not** UPT Not Available.
9a. An **expired unpaid offer** releases its Available plants too, by the same admin-approved path. `exactPlantReleaseReason` is the single rule and gives three reasons, kept distinct in the listing queue and in analytics: `customer_declined`, `accepted_unpaid_expired`, `never_responded_expired`. A plant is only ever released when it is promised to nobody — never while a hold is live, never for UPT Not Available, and never for a paid or Closed request.
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
