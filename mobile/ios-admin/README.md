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
| `mobile/ios-admin/assets/splash-icon.png` | **Yes** — committed store mark | Centered UPT logo on the **native** splash and the in-app intro. Background is always `#002910`. This is the live store mark (teal/green on transparent), not an empty placeholder. |
| `mobile/ios-admin/assets/brand-mark.png` | Unused | Intro uses `splash-icon.png` so both frames match. |

### Native splash vs in-app intro

- **Native splash** (`expo-splash-screen`): `#002910`, `./assets/splash-icon.png`, `imageWidth: 260`, `resizeMode: contain`. Used by a real EAS / dev-client binary.
- **In-app intro** (`AppIntro`): same background and the same splash-icon, ~2.2s hold (logo already visible, short scale). Logo only (no "Request Portal" text). Plays on every cold launch, including a restored `upt_admin_` session. No network. Reduce Motion skips the scale but still holds the logo (~2s). The native splash stays up until the logo is ready so there is no white flash between frames.

### Expo Go differences

These config changes still run in Expo Go for normal development:

- Display name and icon in `app.json` are **not** applied to Expo Go. Expo Go keeps its own name and icon.
- Expo Go's splash is still Expo Go's (white chrome). It also **reuses this project's `splash.image`** (`splash-icon.png`, the store mark) and draws that image on its white canvas. It does **not** apply our `#002910`. That is why the first frame can show the UPT logo on a white background — Expo Go borrowed the image, not the green. We cannot recolor Expo Go's chrome.
- The in-app intro still plays on every cold launch (`#002910` + the same store mark, already visible, then a short scale). That green frame is ours.
- A signed EAS / dev-client build uses our native splash (`#002910` + `splash-icon.png`) and then the same-color intro. There is no Expo Go white frame on that path.
- Custom scheme `uptadmin://request/{id}` is honored in a standalone / EAS binary. Expo Go uses `exp://` for QR-code loads; notification taps still go through the JS listener and stay behind login.
- Photo-library permission copy is applied at **prebuild** time. Expo Go shows Expo Go's own library prompt until you install an EAS build.

### Permissions

- Photo library (current): `Allow access to your photo library so you can upload photos to requests.`
- Camera is **not** requested. The app only opens the photo library. Intended future copy, when a built-in camera exists: `Allow camera access so you can take plant photos for requests.`
- Face ID is **not** requested. Device tokens stay in the iOS Keychain via SecureStore without biometric unlock.

## Visuals

The iPhone UI is its own layer (colors, type, layout, navigation). You can
redesign how the app looks without changing Shopify, inventory, or the
website admin. Look-and-feel changes belong in `mobile/ios-admin/`; business
rules stay in the Render app.

Current design constants:

- page background: `#d6ece2`
- bottom nav: `#002910` with white labels/icons and a yellow selected tab
- display name: Request Portal

## Routine iOS workflow

Cloud Agents work these UI/UX batches without waiting on the owner: inspect,
implement, test (`npx tsc --noEmit`, `npm test`, `npx expo-doctor`,
`npx expo install --check`, `npx expo export --platform ios`), open the PR,
wait for CI, and Squash & Merge when the change is iOS-only and classified
`routine`. Stop for owner approval on auth/tokens, payments, inventory
architecture, destructive data work, or EAS identity changes.

After a routine merge, refresh Expo Go with:

```bat
cd mobile\ios-admin
npx expo start -c
```

Then reload the app on the phone.

Analytics stays on the website only. Token create/revoke stays in the
website Settings page.
