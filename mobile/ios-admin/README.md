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

## Next slices (same backend)

These stay connected to Shopify by calling the existing server code — not a
new inventory system:

- Edit a request item (exact plant / link website stock / not available)
- Photos
- Send offer and close request
- EXACT PLANTS review and listing
- Analytics and settings

Until those land, the Shopify Admin iOS app still has the full embedded portal.
