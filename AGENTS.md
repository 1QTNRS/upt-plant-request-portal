# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Shopify App Template (React Router)** — an embedded Shopify admin app (React Router v7 SSR + Vite) that uses **Prisma + SQLite** for session storage.

### Services / commands

There is a single web service. Standard commands live in `package.json` scripts; notable ones:

- Lint: `npm run lint` — ESLint.
- Typecheck: `npm run typecheck` — `react-router typegen && tsc --noEmit`.
- Build: `npm run build` — React Router (Vite) production build.
- DB setup: `npm run setup` — `prisma generate && prisma migrate deploy` (creates `prisma/dev.sqlite`).

The GitHub CI (`.github/workflows/ci.yml`) is the source of truth for verification: install → `tsc --noEmit` → `npm run lint` → `prisma generate && prisma validate` → `npm run build`.

### Running the app (important caveat)

`npm run dev` runs `shopify app dev`, which requires the Shopify CLI, a Shopify Partner login, and a public tunnel. **This does not work in the headless cloud VM.** To run the app in development mode locally, run the underlying React Router (Vite) dev server directly with placeholder env vars:

```bash
SHOPIFY_API_KEY=devkey SHOPIFY_API_SECRET=devsecret \
SHOPIFY_APP_URL=http://localhost:3000 SCOPES=write_products PORT=3000 \
npx react-router dev
```

The public landing page renders at `http://localhost:3000/`. Submitting the "Shop domain" login form issues a 302 redirect to `https://admin.shopify.com/store/<shop>/oauth/install?client_id=<SHOPIFY_API_KEY>`, which confirms the auth flow is wired up. Fully authenticating against a real store / the embedded admin requires real Shopify credentials and a tunnel and is not possible headless.

### Notes / gotchas

- No lockfile is committed; `npm install` (used by the update script), `yarn`, and `pnpm` all work (all three run in CI). `.npmrc` sets `engine-strict=true`, so Node must satisfy `package.json` `engines` (`>=20.19 <22 || >=22.12`).
- `@prisma/client` is generated code: run `npx prisma generate` after installing/updating deps (the update script does this). `prisma/dev.sqlite` is gitignored — run `npm run setup` (or `npx prisma migrate deploy`) to create it before running the app.
- The repository currently has **pre-existing** lint and typecheck errors in the custom app code (e.g. `app/routes/app.customer-offer-preview.tsx`, `app/lib/sample-*.ts`). These are code issues, not environment problems; the tools themselves run correctly.
