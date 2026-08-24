# UPT Admin (iOS)

Dedicated iPhone client for the UPT Plant Request Portal. It uses the **same**
Render app, Prisma data, and Shopify Admin connection as the website — draft
orders, inventory holds, Exact Plants, and Files stay on the server.

The phone never talks to Shopify directly and never holds Admin API secrets.
A lost phone is revoked from **Settings → iOS admin app**.

## Now

Sign in with a device token, browse requests, and work a request on the phone:

- Offer Exact Plant / Link Existing Website Stock / Not Available
- Price, weight, notes, photos (library or URL)
- Search and link live website stock
- Send offer (3 / 5 / 7 day hold)
- Internal notes, close declined, Close Entire Request

Every write goes through the same Render functions as the website. The phone never talks to Shopify.

You do **not** need a Mac. Install [Expo Go](https://expo.dev/go) on the iPhone.

1. After this work is live: Shopify admin → **UPT Plant Request Portal → Settings → iOS admin app → Create device token**. Copy it immediately.
2. On a computer:

```bash
cd mobile/ios-admin
npm install
npx expo start
```

3. Scan the QR code. Default App URL is the live Render service.

## Visuals

The iPhone UI is its own layer (colors, type, layout, navigation). You can
redesign how the app looks without changing Shopify, inventory, or the
website admin. Look-and-feel changes belong in `mobile/ios-admin/`; business
rules stay in the Render app.

## Next slices (same backend)

- EXACT PLANTS review and listing
- Settings (FedEx warning) on the phone

Analytics stays on the website only. Token create/revoke stays in the
website Settings page.
