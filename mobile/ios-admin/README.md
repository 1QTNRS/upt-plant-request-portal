# UPT Admin (iOS)

Dedicated iPhone client for the UPT Plant Request Portal. It uses the **same**
Render app, Prisma data, and Shopify Admin connection as the website — draft
orders, inventory holds, Exact Plants, and Files stay on the server.

The phone never talks to Shopify directly and never holds Admin API secrets.
A lost phone is revoked from **Settings → iOS admin app**.

## Now (first slice)

Sign in with a device token, browse requests, open a request.

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

These stay connected to Shopify by calling the existing server code — not a
new inventory system:

- Edit a request item (exact plant / link website stock / not available)
- Photos
- Send offer and close request
- EXACT PLANTS review and listing
- Settings (tokens, FedEx warning)

Analytics stays on the website only. Until the slices above land, the
Shopify Admin iOS app still has the full embedded portal.
