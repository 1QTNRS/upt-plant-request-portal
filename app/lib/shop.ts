export const DEMO_SHOP = "demo-shop.myshopify.com";

export function isDevAdminBypass(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.SHOPIFY_API_KEY === "devkey"
  );
}
