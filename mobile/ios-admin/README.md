# UPT Admin (iOS)

Dedicated iPhone client for the UPT Plant Request Portal. It uses the **same**
Render app, Prisma data, and Shopify Admin connection as the website — draft
orders, inventory holds, Exact Plants, and Files stay on the server.

The phone never talks to Shopify directly and never holds Admin API secrets.
A lost phone is revoked from **Settings → iOS admin app**.

## Now

Sign in with a device token. Three tabs on the phone:

- **Requests** — work a request: Exact Plant / Link Stock / Not Available, photos, send offer, notes, close
- **EXACT PLANTS** — review, approve, or dismiss declined / expired exact plants
- **Settings** — FedEx warning and admin notification email

Every write goes through the same Render functions as the website. The phone never talks to Shopify. Token create/revoke stays on the website. Analytics stays on the website.

You do **not** need a Mac. Install [Expo Go](https://expo.dev/go) on the iPhone. This project uses **Expo SDK 54**, which matches current Expo Go.

1. After this work is live: Shopify admin → **UPT Plant Request Portal → Settings → iOS admin app → Create device token**. Copy it immediately.
2. On a computer (Windows, from the repo root):

```bat
cd mobile\ios-admin
npm install
npx expo start -c
```

3. Scan the QR code. Default App URL is the live Render service.

## Visuals

The iPhone UI is its own layer (colors, type, layout, navigation). You can
redesign how the app looks without changing Shopify, inventory, or the
website admin. Look-and-feel changes belong in `mobile/ios-admin/`; business
rules stay in the Render app.

Analytics stays on the website only. Token create/revoke stays in the
website Settings page.
