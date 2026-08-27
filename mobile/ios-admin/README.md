# Request Portal (iOS admin)

Dedicated iPhone client for the UPT Plant Request Portal. It uses the **same**
Render app, Prisma data, and Shopify Admin connection as the website — draft
orders, inventory holds, Exact Plants, and Files stay on the server.

The phone never talks to Shopify directly and never holds Admin API secrets.
A lost phone is revoked from **Settings → iOS admin app**.

## Now

Sign in with a device token. Three tabs on the phone:

- **Requests** — work a request: Exact Plant / Link Stock / Not Available, photos, send offer, notes, close
- **EXACT PLANTS** — review, approve, or dismiss declined / expired exact plants
- **Settings** — FedEx warning, admin emails, and iOS push toggles

Every write goes through the same Render functions as the website. The phone never talks to Shopify. Token create/revoke stays on the website. Analytics stays on the website.

You do **not** need a Mac for day-to-day development. Install [Expo Go](https://expo.dev/go) on the iPhone. This project uses **Expo SDK 54**, which matches current Expo Go.

1. After this work is live: Shopify admin → **UPT Plant Request Portal → Settings → iOS admin app → Create device token**. Copy it immediately.
2. On a computer (Windows, from the repo root):

```bat
cd mobile\ios-admin
npm install
npx expo start -c
```

3. Scan the QR code. Default App URL is the live Render service.

## First Apple build (EAS)

Expo/EAS identity (do not change):

- owner: `unsolicited-plant-talks`
- slug: `upt-admin-ios`
- projectId: `2c4abfc0-98d5-462b-abd0-8ecba3deeeed`
- bundleIdentifier: `com.unsolicitedplanttalks.admin`
- scheme: `uptadmin`
- live API URL: `https://upt-plant-request-portal.onrender.com`

iPhone display name is **Request Portal**. Version is **1.0.0**. Production EAS builds use `autoIncrement` for the iOS build number (`eas.json` `appVersionSource: remote`). Do not invent a second build-number scheme.

Profiles: `development` (dev client), `preview` (internal), `production` (autoIncrement). Apple Developer enrollment and APNs are handled separately — this repo does not create credentials.

### Assets you must provide before the first store build

| File | Required | Purpose |
| --- | --- | --- |
| `mobile/ios-admin/assets/icon.png` | **Yes** — 1024×1024 PNG | iOS app icon. Configured in `app.json`. Do not commit a fake placeholder. |
| `mobile/ios-admin/assets/splash-icon.png` | Optional | Logo on the **native** splash (solid `#002910` until you add this). After adding it, set `splash.image` / the `expo-splash-screen` plugin `image` to `./assets/splash-icon.png`. |
| `mobile/ios-admin/assets/brand-mark.png` | Optional | In-app intro mark. After adding it, set `APP_INTRO_BRAND_MARK` in `src/app-intro-assets.ts` to `require("../assets/brand-mark.png")`. Until then the intro uses a "Request Portal" wordmark. |

### Native splash vs in-app intro

- **Native splash** (`expo-splash-screen`): static `#002910`. Fast. Used by a real EAS / dev-client binary.
- **In-app intro** (`AppIntro`): ~1.1s fade/scale after the native splash. Skipped when a saved `upt_admin_` session is being restored. No network. Respects Reduce Motion (finishes immediately).

### Expo Go differences

These config changes still run in Expo Go for normal development:

- Display name, icon, and native splash in `app.json` are **not** applied to Expo Go. Expo Go keeps its own name, icon, and splash. The in-app intro still plays on a fresh sign-in.
- Custom scheme `uptadmin://request/{id}` is honored in a standalone / EAS binary. Expo Go uses `exp://` for QR-code loads; notification taps still go through the JS listener and stay behind login.
- Photo-library permission copy is applied at **prebuild** time. Expo Go shows Expo Go's own library prompt until you install an EAS build.

### Permissions

- Photo library (current): `Allow access to your photo library so you can upload photos to requests.`
- Camera is **not** requested. The app only opens the photo library. Intended future copy, when a built-in camera exists: `Allow camera access so you can take plant photos for requests.`

## Visuals

The iPhone UI is its own layer (colors, type, layout, navigation). You can
redesign how the app looks without changing Shopify, inventory, or the
website admin. Look-and-feel changes belong in `mobile/ios-admin/`; business
rules stay in the Render app.

Analytics stays on the website only. Token create/revoke stays in the
website Settings page.
