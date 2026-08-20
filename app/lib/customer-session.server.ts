import { createCookie } from "react-router";

import { DEMO_SHOP, isDevAdminBypass } from "./shop";

export type CustomerSession = {
  shop: string;
  email: string;
  name: string;
  shopifyCustomerId?: string;
};

const customerCookie = createCookie("upt_customer_session", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secrets: [process.env.SHOPIFY_API_SECRET || "devsecret"],
});

export async function readCustomerSession(
  request: Request,
): Promise<CustomerSession | null> {
  const url = new URL(request.url);
  const loggedInCustomerId =
    url.searchParams.get("logged_in_customer_id") ||
    request.headers.get("x-shopify-customer-id");

  if (loggedInCustomerId) {
    const shop =
      request.headers.get("x-shopify-shop-domain") ||
      process.env.SHOP_CUSTOM_DOMAIN ||
      DEMO_SHOP;
    return {
      shop,
      email: "",
      name: "",
      shopifyCustomerId: loggedInCustomerId,
    };
  }

  const raw = await customerCookie.parse(request.headers.get("Cookie"));
  if (raw && typeof raw === "object" && "email" in raw) {
    return raw as CustomerSession;
  }

  return null;
}

export async function serializeCustomerSession(
  session: CustomerSession,
): Promise<string> {
  return customerCookie.serialize(session);
}

export async function destroyCustomerSession(): Promise<string> {
  return customerCookie.serialize("", { maxAge: 0 });
}

export function canUseDemoCustomerLogin(): boolean {
  return isDevAdminBypass() || process.env.ALLOW_CUSTOMER_DEMO_LOGIN === "true";
}
