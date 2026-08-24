# UPT Admin (iOS)

First slice of the iPhone admin app: sign in with a device token, browse
requests, and open a request. Offer editing, photo upload, Exact Plants, and
analytics stay in the Shopify admin web app for now.

You do **not** need a Mac to try this. Install [Expo Go](https://expo.dev/go)
on your iPhone.

## 1. Create a device token

In the live Shopify admin: **UPT Plant Request Portal → Settings → iOS admin app → Create device token**.

Copy the token immediately. It is not stored in plaintext.

## 2. Run the app

```bash
cd mobile/ios-admin
npm install
npx expo start
```

Scan the QR code with the iPhone camera (or Expo Go). Paste the token. The
default App URL is the live Render service.

A lost phone: revoke that token on the same Settings page.

## What this first slice does not do

Sending an offer, linking website stock, uploading photos, EXACT PLANTS review,
and analytics. Use the Shopify Admin iOS app (the embedded portal) for those
until the next slices land.
