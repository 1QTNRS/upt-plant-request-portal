# Automated delivery: PR → merge → Render → smoke

This is the development, deployment, and testing contract for routine work on
the UPT Plant Request Portal. It does **not** replace
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) for account actions, and it
never targets the live UPT store.

Approved automation shop (hardcoded, not overridable):

`upt-plant-request-dev.myshopify.com`

Forbidden:

- `unsolicited-plant-talks.myshopify.com`
- `unsolicitedplanttalks.myshopify.com`

## Intended flow

```
Cursor finishes a branch
  → local/CI tests
  → PR opened
  → GitHub CI green (includes local Playwright)
  → classifier labels routine or high-risk
  → routine PR: mark ready + Squash & Merge
  → Render auto-deploys main (native, checksPass)
  → post-deploy job waits until /versionz serves that SHA
  → guarded dev-store smoke (when secrets are set)
  → GitHub reports PASS or FAIL
```

High-risk PRs stop after CI. The owner squash-merges. Render + smoke still run
automatically once `main` moves.

## PR classification

`app/lib/pr-risk.ts` classifies from title, body, labels, and changed files.
Uncertain diffs (including an empty file list) are **high-risk**.

### Routine / low-risk (auto-merge after CI)

UI refinements, responsive/mobile fixes, wording, dashboard filters/sorting,
photo UX, visual navigation, non-destructive bug fixes, additional automated
tests, **iOS admin UI/UX in `mobile/ios-admin` that does not change auth,
tokens, API URL, or EAS identity**, and other changes that do **not**
materially alter payments, inventory integrity, authentication, customer
isolation, production resources, or destructive data behavior.

Routine iOS batches are autonomous: implement, test (`tsc`, `npm test`,
`expo-doctor`, `expo install --check`, iOS export), open/update the PR, wait
for CI, and Squash & Merge when the classifier says `routine`. After merge,
tell the owner only how to refresh Expo Go. See **Request Portal iOS standing
workflow** in [AGENTS.md](../AGENTS.md).

### High-risk (owner approval required)

Cursor must ask, and GitHub will not auto-merge, when a PR touches:

- production UPT store configuration or mappings (`shopify.app.toml`)
- real Shopify resource writes (`shopify-ops`, Grower's Choice, draft-order void)
- payment / Draft Order / inventory / reservation architecture
- destructive database migrations (`prisma/`)
- data-deletion behavior (`smoke-cleanup`, dismiss/delete paths that qualify)
- authentication, authorization, customer isolation (`admin-auth`,
  `customer-identity`, `customer-session`, `app-proxy`, `auth` routes)
- webhook security
- privacy / request-log redaction (`server.js`)
- major infrastructure (`render.yaml`, `Dockerfile`, `.github/workflows/`)
- the classifier or smoke-auth helpers themselves
- anything that could affect real orders, money, customer data, or production
  inventory

An explicit `high-risk` or `needs-approval` label always wins.

If classification is uncertain, treat it as high-risk and ask the owner.

### When Cursor can auto-merge

Only when **all** of these are true:

- the classifier returns `routine`
- required CI is green
- GitHub reports the branch as `MERGEABLE`
- the PR is not already merged

Drafts opened by Cloud Agents are marked ready automatically **only** in that
routine path. High-risk drafts stay drafts.

### When Cursor must ask

Any high-risk path, label, or uncertainty. Tests being green is not enough.

## Render auto-deploy

`render.yaml` sets `branch: main` and `autoDeployTrigger: checksPass` on the web
service and the cron job. There is no second deploy system.

**USER ACTION REQUIRED:** open the Render Blueprint (or each service's Settings)
and confirm both services track `main`. A leftover working branch is why
"Deploy latest commit" used to be a habit. Do not click it for normal merges
once `main` is the tracked branch.

Never set `DEV_SHOP`, `ALLOW_CUSTOMER_DEMO_LOGIN`, or `SHOPIFY_API_KEY=devkey`
on Render.

## Exact SHA verification

`GET /versionz` returns only `{ status, commit, migrations }`.

- `commit` is `RENDER_GIT_COMMIT` (or `SOURCE_VERSION` / `GIT_COMMIT`)
- `migrations` is `applied` when the database answers `SELECT 1`
- no env, tokens, customer data, or session material

`scripts/wait-for-deploy.mjs` polls `/versionz` until `status=ok`,
`migrations=applied`, and `commit` matches `EXPECTED_SHA` (full SHA or prefix).
Timeout (default 12 minutes) fails with expected vs last-seen SHA. It does not
sleep blindly and then continue.

`/healthz` stays `{status:ok}` only and is what Render uses for rotation.

## Smoke tests

Two suites:

| Command | Where | Needs secrets? |
| --- | --- | --- |
| `npm run test:e2e` | local demo shop via `SHOPIFY_API_KEY=devkey` | no |
| `npm run test:e2e:dev-store` | live Render URL + approved Shopify dev shop | yes |

Local Playwright covers:

- `/healthz` and `/versionz` (no secret leak)
- customer demo login, request submit, initial **New** status
- Home → `/` and My Requests → `/customer` in the local demo
- customer offer page for a declined Exact Plant
- EXACT PLANTS sortable table, filters, collapse, Request # link, listing/dismiss
  actions, admin photo lightbox (open, next/prev, Escape, Close)

Live Playwright (after SHA is live) covers:

- shop hard-guard
- live `/versionz`
- admin EXACT PLANTS via the smoke helper (no Shopify OTP)
- cleanup of automation rows

Not fully automated against the live storefront (Shopify customer OTP):

- a real customer Account login / email OTP
- creating a live Draft Order and paying it
- real inventory reservation on Shopify
- large/unusual photo uploads

Those stay on the local demo or on a short owner pass. Production
authentication is not weakened to make Playwright easier.

### Test-data cleanup

Automation emails must match `smoke+…@upt-smoke.test`.

`cleanupSmokePortalData` deletes only those customers and their requests, and
only for `upt-plant-request-dev.myshopify.com`. Any other shop throws. The
shop argument is compared to a hardcoded constant; there is no env override.

Cleanup runs from `e2e/dev-store/cleanup.spec.ts` after the live suite
(`afterAll`) and can be POSTed to `/smoke/cleanup` with a valid smoke token.

It never deletes unrelated manual dev-store data or production UPT rows.

### Smoke admin helper

`SMOKE_TEST_SECRET` (≥16 chars) **and** `ALLOW_SMOKE_ADMIN=true` must both be
set. The token is HMAC-bound to the approved shop and cannot select another
shop. The helper is refused when either value is missing.

Do not enable it unless you intend post-deploy admin smoke against the Render
URL. It still cannot see production-shop rows.

## GitHub secrets and variables

**USER ACTION REQUIRED** in the GitHub repo:

| Name | Purpose |
| --- | --- |
| `SMOKE_TEST_SECRET` | HMAC for the smoke admin helper (≥16 chars). Same value on Render if live admin smoke should run. |
| `SHOPIFY_API_SECRET` | Sign app-proxy customer URLs in the live suite |
| `SHOPIFY_API_KEY` | optional; not `devkey` |
| `APP_BASE_URL` (variable) | defaults to `https://upt-plant-request-portal.onrender.com` |

**USER ACTION REQUIRED** on the Render web service (optional, only for live admin smoke):

- `ALLOW_SMOKE_ADMIN=true`
- `SMOKE_TEST_SECRET` (same as GitHub)

**USER ACTION REQUIRED** in GitHub repo settings:

- Create labels `high-risk`, `needs-approval`, `routine` (the classify workflow tries to create them)
- Allow GitHub Actions to squash-merge (Actions permissions + no blocking branch rules)
- Make the `CI` check required so Render `checksPass` and auto-merge agree
- Do **not** require extra reviews on routine PRs if you want them to merge unattended

## Failure artifacts

On Playwright failure GitHub uploads `test-results` and `playwright-report`:

- trace
- screenshots
- test title (the business flow name)

Do not commit or upload:

- passwords
- cookies / session tokens (redact if a trace is shared)
- Shopify access tokens
- customer PII
- authorization headers
- API secrets

Traces are retained on failure only.

## What still needs a human

Manual review remains useful for:

- whether the lightbox feels good on an iPhone
- swipe feel
- spacing / layout aesthetics
- wording / tone
- unusual real-world large photo uploads
- genuinely new UX that does not yet have smoke coverage
- high-risk PRs (always)

**COMPUTER NEEDED** for first-time Render Blueprint branch confirmation and
GitHub secret/label/permission clicks. An iPhone can review a high-risk PR but
cannot apply those account settings.

The goal is not zero human review. The goal is to stop repeating known stable
workflows by hand.
