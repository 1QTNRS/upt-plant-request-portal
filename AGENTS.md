# AGENTS.md

Read **[docs/CLOUD_AGENT_HANDOFF.md](docs/CLOUD_AGENT_HANDOFF.md)** before changing this app. It is the durable handoff for Cloud Agents: what is live, what is still demo, Shopify gaps, business rules, and productionization steps.

Then read **[docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md)**. Production hosting is **Render** (Docker web service, managed PostgreSQL, cron job), declared in `render.yaml`. Do not reimplement anything listed there, and edit `render.yaml` rather than configuring Render by hand.

**One code task is outstanding and already decided** — making an expired hold's invoice unpayable. It is the second entry under "Business decisions taken by the owner" in the handoff. **Grower's Choice inventory reservation has never been observed working on a real store**; the handoff's "Required live dev-store verification" lists the four runs that would settle it, and until they pass, do not offer Grower's Choice on the real UPT store.

Do **not** rebuild the UPT Plant Request Portal. Continue from the Prisma-backed React Router app on the existing working branch. Do not resurrect `app/lib/sample-*.ts` or other localStorage prototype modules as the source of truth.

## Cursor Cloud specific instructions

This repo is the **UPT Plant Request Portal** on the Shopify App Template (React Router) — an embedded Shopify admin app (React Router v7 SSR + Vite) that uses **Prisma** for session storage and portal data. `DATABASE_URL` selects the provider: **SQLite** for local development (the default when it is unset), **PostgreSQL** in production.

### Services / commands

There is a single web service. Standard commands live in `package.json` scripts; notable ones:

- Lint: `npm run lint` — ESLint.
- Typecheck: `npm run typecheck` — `react-router typegen && tsc --noEmit`.
- Build: `npm run build` — React Router (Vite) production build.
- Tests: `npm test` — `tsx --test --test-concurrency=1 app/lib/*.test.ts`. Some suites hit the database, so run `npm run setup` first. Keep the runner serial: the DB-backed suites share one database, and running their files in parallel caused SQLite lock timeouts on CI runners.
- DB setup: `npm run setup` — generates the client and applies migrations for whichever provider `DATABASE_URL` names (creates `prisma/dev.sqlite` when unset).
- Seed: `node scripts/prisma.mjs db seed` (also runs via `ensureShopSeeded` under the dev bypass only).
- Shopify call validation: `npm run validate-graphql` — fetches the live Admin schema and checks every `#graphql` document plus the variable payloads. **Needs network.** Run after touching any Shopify call.
- Prisma schema sync: `npm run prisma:sync-schema` after editing `prisma/schema.prisma`; `npm run prisma:check-schema` (in CI) fails when the generated PostgreSQL schema is stale.

The GitHub CI (`.github/workflows/ci.yml`) is: install → `tsc --noEmit` → `npm run lint` → validate both Prisma schemas → schema-sync check → **`npm test` on SQLite** → **`npm test` on PostgreSQL** → `npm run build`.

### Verifying deployment changes

Docker is not preinstalled but can be installed and run in the Cloud VM. Overlayfs is unavailable, so the daemon needs the **vfs** storage driver (`/etc/docker/daemon.json` with `{"storage-driver":"vfs"}`, then `sudo dockerd`). PostgreSQL can be installed with `apt-get install postgresql` and started with `pg_ctl`. Both were used to verify the production image end to end.

### Running the app (important caveat)

`npm run dev` runs `shopify app dev`, which requires the Shopify CLI, a Shopify Partner login, and a public tunnel. **This does not work in the headless cloud VM.**

**Never run `shopify app dev` against the production app.** `shopify.app.toml` holds the live Render URLs and sets `automatically_update_urls_on_dev = false`; a tunnel-based session belongs on `shopify.app.dev.toml` (`shopify app config use dev`) with a separate development app.

To run the app in development mode locally, run the underlying React Router (Vite) dev server directly with placeholder env vars — this needs no Shopify app, tunnel or Partner login:

```bash
SHOPIFY_API_KEY=devkey SHOPIFY_API_SECRET=devsecret \
SHOPIFY_APP_URL=http://localhost:3000 SCOPES=write_products PORT=3000 \
npx react-router dev
```

`SHOPIFY_API_KEY=devkey` enables the local admin bypass (`demo-shop.myshopify.com` or `DEV_SHOP`) and non-embedded admin chrome. The public landing page renders at `http://localhost:3000/`. Admin is `/app`. Customer portal is `/customer` (demo login: Alex Rivera). Customer index forms must POST to `?index`.

Submitting the landing-page "Shop domain" login form issues a 302 redirect to `https://admin.shopify.com/store/<shop>/oauth/install?client_id=<SHOPIFY_API_KEY>`, which confirms the template auth flow is wired up. Fully authenticating against a real store / the embedded admin requires real Shopify credentials and a tunnel and is not possible headless.

### Notes / gotchas

- No lockfile is committed; `npm install` (used by the update script), `yarn`, and `pnpm` all work (all three run in CI). `.npmrc` sets `engine-strict=true`, so Node must satisfy `package.json` `engines` (`>=20.19 <22 || >=22.12`).
- `@prisma/client` is generated code and is **provider-specific**: run `npm run prisma:generate` (not bare `npx prisma generate`) after installing/updating deps or after changing `DATABASE_URL`, so the client matches the schema. `prisma/dev.sqlite` is gitignored — run `npm run setup` to create it before running the app.
- Edit `prisma/schema.prisma`, never `prisma/postgres/schema.prisma`; the latter is generated.
- Request numbers are `REQ1`, `REQ2`, `REQ2178` (sequential, unpadded). Sequence row uses `RequestNumberSequence.year = 0`.
- Local demo Shopify mutations (draft orders, Files, EXACT PLANTS products) no-op or stub when `admin` is missing. Declined-item listings still must **not** create a product until admin approves the review form.
- Customer-facing links must go through the storefront app proxy (`customerLinksForShop` / `customerPortalRelativeLinks`). A link to the app's own origin carries no signed identity and renders "Request not available".
- App proxy pages **never hydrate** (their `/assets/...` URLs resolve against the shop domain). In `app/routes/customer*`: plain `<form>` not `<Form>`, real `name`/`defaultValue` on every input, submit buttons with an `intent` instead of `onClick`, and **never React Router's `?index`** — React Router strips `index` from the URL, which breaks the app proxy HMAC. See the handoff doc for the full rules; both customer pages follow them.
- `ensureShopSeeded` must only ever run under the dev bypass. It previously ran on a production code path and seeded demo requests into the live database.
- Leftover prototype files (`app/lib/sample-*.ts`, `item-*.ts`, `customer-request-submissions.ts`, etc.) are unused by active routes.
- Two environment modules exist on purpose: `env.server.ts` is the boot-time contract, `environment.server.ts` is per-request shop-scoped gating (`isDemoDataEnabled`, `canStubShopifyWrites`). `isProductionRuntime()` delegates to `isProduction()`; never add a third definition of "in production".
- Similarly, `customer-identity.ts` is pure request-ownership authorization and `customer-identity.server.ts` resolves a name/email from the Admin API. Different concerns, similar names.
- **Never hand a live database to a Prisma command as a shadow database.** `prisma migrate diff --shadow-database-url "$DATABASE_URL"` reads like inspection and is not: Prisma empties the shadow database. Run against the dev store's database it destroyed every row including the Shopify offline session. `migrate dev`, `migrate reset` and `db push` are the same hazard.
- Shopify folds `read_x` into the `write_x` that implies it, so a correctly installed store's granted list omits the read scopes. Compare through `coveredScopes` (`env.server.ts`), never as raw strings.
- Both Render services deploy from `cursor/production-readiness-blockers-7617` with auto-deploy on. Deploying another branch's commit by id works but is replaced by the next push to that branch.
- The dev store contradicts Shopify's own docs in several places (null `Publication.catalog`, POS handle `pos`, missing `Shop.domainsPaginated`). The handoff has the table; check it before trusting a deprecation notice.
- The Help glossary (`help-glossary.ts`, `help-topics.ts`) is content in code, and every entry quotes the file it is grounded in. `help-content.test.ts` reads those files and fails when a quote has moved, so **changing a business rule breaks the entry that describes it** — update the entry rather than the quote. Answers must come from that content; the assistant refuses what is not in it.

### Security invariants

- App proxy signatures expire after five minutes (`appProxyRequestIsFresh`). A valid signature is a bearer token for that customer's identity; without expiry a captured URL replayed an hour later returned their request list.
- The request log keeps an **allow list** of query parameters whose values may be written (`redactUrl` in `server.js`). `signature`, `logged_in_customer_id`, `id_token` and everything the customer typed are redacted. A new parameter is redacted by default — keep it that way.
- `server.js` withholds the storefront `Origin` from React Router's cross-origin check for signed app-proxy requests only, and the app decides (`forwardedOriginIsTrusted`). Do not widen `allowedActionOrigins` instead: it is build-wide and would relax the same check for the embedded admin, where the merchant's session cookie is the thing being protected.

### Business rules to preserve

- Statuses stored: New / Pending / Closed / Expired. Customer labels are derived by `formatCustomerStatusLabel`: Pending and unanswered is **Offer Ready for Review**, answered with something payable is **Needs Payment**, and nothing payable is **No Payment Needed**. Labels change, stored statuses do not.
- An Available item needs an exact plant photo, a price and a weight before its offer can be sent; `sendOffer` refuses and names what is missing. Customer-facing notes stay optional.
- Admin email is only ever two events: a new request, and one summary per customer response. The customer gets one consolidated email per response.
- No quantity field on the customer form; quantity is 1. No Budget in the active customer workflow.
- Offer snapshots freeze after send. FedEx is optional, default on, excluded from plant analytics, never listed in EXACT PLANTS.
- Draft orders only for accepted plants. `orders/paid` closes the request.
- A Declined Item is Available + offered + customer Reject. Not the same as UPT Not Available. Do not auto-publish. Admin review/approve only. One Shopify product per declined item, EXACT PLANTS collection, Online Store + POS only.
- **Owner decision:** a declined exact plant stays eligible for the EXACT PLANTS queue even once the request is `Closed`. Payment decides eligibility, not the status — `Closed` means paid *or* closed because there was nothing to pay for, and only the first puts a plant out of reach. Do not reintroduce a bare `Closed` check in `exactPlantReleaseReason`.
- **Owner decision, not yet implemented:** when an unpaid hold expires, the Shopify draft order must be voided or made non-payable, so a released plant cannot be relisted *and* paid for. Today the invoice stays live and the customer is only warned. This is the next code task; the handoff has the constraints.
- A Grower's Choice item sells a real Shopify `variantId` and is reserved only at accept time, via `reserveInventoryUntil`, until the offer's own deadline. Linking reserves nothing. Never oversell: if stock has gone, create nothing and name the plant to the admin. A rejected Grower's Choice item does **not** enter the EXACT PLANTS queue — that plant already has a product.
- An EXACT PLANTS listing is **one physical plant**: its variant tracks inventory, holds one unit, and denies oversell. Stock it before publishing, or it goes live showing as sold out.
- A customer may only ever see their own requests. App-proxy identity is only trustworthy after the HMAC check in `app/lib/app-proxy.ts`; never read `logged_in_customer_id` without it.
- A plant keeps **two** names for good: `RequestItem.plantName` is the customer's own wording and is never normalised in place, `RequestItem.canonicalPlantId` is the identity analytics group on. Only `high` confidence links two spellings automatically; `medium` opens a `PlantIdentitySuggestion` for admin review and merges nothing. Cultivars, quoted names, accession/clone/collection/seedling numbers, collector codes and localities are never merged automatically — a silent wrong merge corrupts per-plant figures invisibly, which is worse than two rows.
- Plant-name AI is optional and off by default (`plant-identity-ai.server.ts`, no credential configured). It may only ever *suggest*, is capped at medium confidence, and must never auto-link an identity, reserve inventory or create an offer. No core flow may come to require it.
- Behaviour flags, including **Repeated Request / Decline Pattern**, are admin-only insight. They must never appear in a customer-facing route and must never block a customer; `plant-behavior.test.ts` enforces the first half.
