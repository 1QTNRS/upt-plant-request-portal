import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";

import { CustomerRequestPortal } from "../components/customer-request-portal";
import { DEMO_SHOP, isDevAdminBypass } from "../lib/shop";
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
import { ensureShopSeeded } from "../lib/seed-demo.server";

const DEMO_CUSTOMER = {
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
  shopifyCustomerId: "demo-customer-alex",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = process.env.DEV_SHOP || DEMO_SHOP;
  if (isDevAdminBypass()) {
    await ensureShopSeeded(shop);
  }

  const session = await readCustomerSession(request);
  if (!session) {
    return {
      loggedIn: false,
      name: "",
      email: "",
      myRequests: [],
      showDemoLogin: canUseDemoCustomerLogin(),
    };
  }

  const customer = await findOrCreateCustomer(session.shop || shop, {
    name: session.name || DEMO_CUSTOMER.name,
    email: session.email || DEMO_CUSTOMER.email,
    shopifyCustomerId: session.shopifyCustomerId,
  });
  const requests = await listCustomerRequests(customer.shop, {
    email: customer.email,
    shopifyCustomerId: customer.shopifyCustomerId ?? undefined,
  });

  return {
    loggedIn: true,
    name: customer.name,
    email: customer.email,
    showDemoLogin: canUseDemoCustomerLogin(),
    myRequests: requests.map((request) => ({
      id: request.id,
      requestNumber: getDisplayRequestNumber(request),
      submittedDate: request.submittedDate,
      plantsRequested: request.items.map((item) => item.plantName).join(", "),
      status: request.status,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = process.env.DEV_SHOP || DEMO_SHOP;
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
        shop,
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

  const created = await submitCustomerRequest(session.shop || shop, {
    name: session.name,
    email: session.email,
    shopifyCustomerId: session.shopifyCustomerId,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(session.shop || shop, created.id);

  return {
    errors: [],
    successMessage: `Request submitted. Your request number is ${created.requestNumber}. We'll notify you when matching plants become available.`,
  };
};

export default function CustomerHome() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CustomerRequestPortal
      loggedIn={loaderData.loggedIn}
      name={loaderData.name}
      email={loaderData.email}
      myRequests={loaderData.myRequests}
      successMessage={actionData?.successMessage}
      errors={actionData?.errors}
      showDemoLogin={loaderData.showDemoLogin}
      requestDetailHref={(requestId) => `/customer/requests/${requestId}`}
      formAction="?index"
    />
  );
}
