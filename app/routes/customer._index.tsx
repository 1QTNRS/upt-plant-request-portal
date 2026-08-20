import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";

import { CustomerRequestPortal } from "../components/customer-request-portal";
import { DEMO_SHOP } from "../lib/shop";
import { isDemoDataEnabled } from "../lib/environment.server";
import {
  canUseDemoCustomerLogin,
  destroyCustomerSession,
  readCustomerSession,
  serializeCustomerSession,
} from "../lib/customer-session.server";
import { notifyNewRequest } from "../lib/emails.server";
import { getDisplayRequestNumber } from "../lib/portal";
import {
  findOrCreateCustomer,
  listCustomerRequests,
  submitCustomerRequest,
} from "../lib/portal.server";
import { ensureShopSeeded, ensureShopSettings } from "../lib/seed-demo.server";

const DEMO_CUSTOMER = {
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
  shopifyCustomerId: "demo-customer-alex",
};

const SIGNED_OUT = {
  loggedIn: false as const,
  name: "",
  email: "",
  myRequests: [],
  canSubmitRequests: false,
  identityError: null as string | null,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const demoShop = process.env.DEV_SHOP || DEMO_SHOP;
  if (isDemoDataEnabled(demoShop)) {
    await ensureShopSeeded(demoShop);
  }

  const session = await readCustomerSession(request);
  if (!session) {
    return { ...SIGNED_OUT, showDemoLogin: canUseDemoCustomerLogin() };
  }

  await ensureShopSettings(session.shop);

  // Without an email we cannot create a profile, but the customer can still
  // read the requests already linked to their Shopify account id.
  if (!session.canSubmitRequests) {
    const requests = await listCustomerRequests(session.shop, {
      shopifyCustomerId: session.shopifyCustomerId,
    });
    return {
      loggedIn: true as const,
      name: session.name,
      email: "",
      canSubmitRequests: false,
      showDemoLogin: canUseDemoCustomerLogin(),
      identityError:
        "We could not read the email address on your store account. Add an email to your account to submit a new plant request.",
      myRequests: requests.map((plantRequest) => ({
        id: plantRequest.id,
        requestNumber: getDisplayRequestNumber(plantRequest),
        submittedDate: plantRequest.submittedDate,
        plantsRequested: plantRequest.items
          .map((item) => item.plantName)
          .join(", "),
        status: plantRequest.status,
      })),
    };
  }

  const customer = await findOrCreateCustomer(session.shop, {
    name: session.name,
    email: session.email,
    shopifyCustomerId: session.shopifyCustomerId,
  });
  const requests = await listCustomerRequests(session.shop, {
    email: customer.email,
    shopifyCustomerId: customer.shopifyCustomerId ?? undefined,
  });

  return {
    loggedIn: true as const,
    name: customer.name,
    email: customer.email,
    canSubmitRequests: true,
    identityError: null as string | null,
    showDemoLogin: canUseDemoCustomerLogin(),
    myRequests: requests.map((plantRequest) => ({
      id: plantRequest.id,
      requestNumber: getDisplayRequestNumber(plantRequest),
      submittedDate: plantRequest.submittedDate,
      plantsRequested: plantRequest.items.map((item) => item.plantName).join(", "),
      status: plantRequest.status,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "demo-login") {
    if (!canUseDemoCustomerLogin()) {
      return { errors: ["Customer login is not available."], successMessage: null };
    }
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      await serializeCustomerSession({
        shop: process.env.DEV_SHOP || DEMO_SHOP,
        ...DEMO_CUSTOMER,
      }),
    );
    throw redirect("/customer", { headers });
  }

  if (intent === "logout") {
    const headers = new Headers();
    headers.append("Set-Cookie", await destroyCustomerSession());
    throw redirect("/customer", { headers });
  }

  const session = await readCustomerSession(request);
  if (!session) {
    return { errors: ["Please log in to submit a request."], successMessage: null };
  }
  if (!session.canSubmitRequests) {
    return {
      errors: [
        "We could not read the email address on your store account. Add an email to your account and try again.",
      ],
      successMessage: null,
    };
  }

  const itemCount = Number(form.get("itemCount") || 0);
  const items: Array<{ plantName: string; notes?: string }> = [];
  for (let index = 0; index < itemCount; index += 1) {
    items.push({
      plantName: String(form.get(`plantName-${index}`) || "").trim(),
      notes: String(form.get(`notes-${index}`) || "").trim() || undefined,
    });
  }

  const errors: string[] = [];
  if (items.filter((item) => item.plantName).length === 0) {
    errors.push("Add at least one plant with a name.");
  }
  if (items.some((item) => !item.plantName)) {
    errors.push("Each plant row needs a plant name or should be removed.");
  }
  if (errors.length) return { errors, successMessage: null };

  await ensureShopSettings(session.shop);
  const created = await submitCustomerRequest(session.shop, {
    name: session.name,
    email: session.email,
    shopifyCustomerId: session.shopifyCustomerId,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(session.shop, created.id);

  return {
    errors: [],
    successMessage: `Request submitted. Your request number is ${created.requestNumber}. We'll notify you when matching plants become available.`,
  };
};

export default function CustomerHome() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const errors = actionData?.errors?.length
    ? actionData.errors
    : loaderData.identityError
      ? [loaderData.identityError]
      : undefined;

  return (
    <CustomerRequestPortal
      loggedIn={loaderData.loggedIn}
      name={loaderData.name}
      email={loaderData.email}
      myRequests={loaderData.myRequests}
      successMessage={actionData?.successMessage}
      errors={errors}
      showDemoLogin={loaderData.showDemoLogin}
      requestDetailHref={(requestId) => `/customer/requests/${requestId}`}
      formAction="?index"
    />
  );
}
