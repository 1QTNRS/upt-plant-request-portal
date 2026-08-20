# AGENTS.md

Read **[docs/CLOUD_AGENT_HANDOFF.md](docs/CLOUD_AGENT_HANDOFF.md)** before changing this app. It is the durable handoff for Cloud Agents: what is live, what is still demo, Shopify gaps, business rules, and productionization steps.

Do **not** rebuild the UPT Plant Request Portal. Continue from the Prisma-backed React Router app on the existing working branch. Do not resurrect `app/lib/sample-*.ts` or other localStorage prototype modules as the source of truth.

## Cursor Cloud specific instructions

This repo is the **UPT Plant Request Portal** on the Shopify App Template (React Router) — an embedded Shopify admin app (React Router v7 SSR + Vite) that uses **Prisma + SQLite** for session storage and portal data.

### Services / commands

There is a single web service. Standard commands live in `package.json` scripts; notable ones:

- Lint: `npm run lint` — ESLint.
- Typecheck: `npm run typecheck` — `react-router typegen && tsc --noEmit`.
- Build: `npm run build` — React Router (Vite) production build.
- Tests: `npm test` — `tsx --test` on `app/lib/portal*.test.ts` and `app/lib/exact-plants*.test.ts`.
- DB setup: `npm run setup` — `prisma generate && prisma migrate deploy` (creates `prisma/dev.sqlite`).
- Seed: `npx prisma db seed` (also runs via `ensureShopSeeded` on admin/customer loaders).

The GitHub CI (`.github/workflows/ci.yml`) is: install → `tsc --noEmit` → `npm run lint` → `prisma generate && prisma validate` → `npm run build`. It does **not** currently run `npm test`.

### Running the app (important caveat)

`npm run dev` runs `shopify app dev`, which requires the Shopify CLI, a Shopify Partner login, and a public tunnel. **This does not work in the headless cloud VM.** To run the app in development mode locally, run the underlying React Router (Vite) dev server directly with placeholder env vars:

```bash
SHOPIFY_API_KEY=devkey SHOPIFY_API_SECRET=devsecret \
SHOPIFY_APP_URL=http://localhost:3000 SCOPES=write_products PORT=3000 \
npx react-router dev
```

`SHOPIFY_API_KEY=devkey` enables the local admin bypass (`demo-shop.myshopify.com` or `DEV_SHOP`) and non-embedded admin chrome. The public landing page renders at `http://localhost:3000/`. Admin is `/app`. Customer portal is `/customer` (demo login: Alex Rivera). Customer index forms must POST to `?index`.

Submitting the landing-page "Shop domain" login form issues a 302 redirect to `https://admin.shopify.com/store/<shop>/oauth/install?client_id=<SHOPIFY_API_KEY>`, which confirms the template auth flow is wired up. Fully authenticating against a real store / the embedded admin requires real Shopify credentials and a tunnel and is not possible headless.

### Notes / gotchas

- No lockfile is committed; `npm install` (used by the update script), `yarn`, and `pnpm` all work (all three run in CI). `.npmrc` sets `engine-strict=true`, so Node must satisfy `package.json` `engines` (`>=20.19 <22 || >=22.12`).
- `@prisma/client` is generated code: run `npx prisma generate` after installing/updating deps. `prisma/dev.sqlite` is gitignored — run `npm run setup` (or `npx prisma migrate deploy`) to create it before running the app.
- Request numbers are `REQ1`, `REQ2`, `REQ2178` (sequential, unpadded). Sequence row uses `RequestNumberSequence.year = 0`.
- Local demo Shopify mutations (draft orders, Files, EXACT PLANTS products) no-op or stub when `admin` is missing. Declined-item listings still must **not** create a product until admin approves the review form.
- Leftover prototype files (`app/lib/sample-*.ts`, `item-*.ts`, `customer-request-submissions.ts`, etc.) are unused by active routes.

### Business rules to preserve

- Statuses stored: New / Pending / Closed / Expired. Customer label for Pending: **Needs Payment**.
- No quantity field on the customer form; quantity is 1. No Budget in the active customer workflow.
- Offer snapshots freeze after send. FedEx is optional, default on, excluded from plant analytics, never listed in EXACT PLANTS.
- Draft orders only for accepted plants. `orders/paid` closes the request.
- A Declined Item is Available + offered + customer Reject. Not the same as UPT Not Available. Do not auto-publish. Admin review/approve only. One Shopify product per declined item, EXACT PLANTS collection, Online Store + POS only.
