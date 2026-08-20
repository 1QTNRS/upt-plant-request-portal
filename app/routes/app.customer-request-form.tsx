import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CustomerRequestPortal } from "../components/customer-request-portal";
import { requireAdmin } from "../lib/admin-auth.server";
import { notifyNewRequest } from "../lib/emails.server";
import {
  getDisplayRequestNumber,
  type CustomerMyRequestRow,
} from "../lib/portal";
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

function toMyRequestRows(email: string, shopifyCustomerId?: string) {
  return async (shop: string): Promise<CustomerMyRequestRow[]> => {
    const requests = await listCustomerRequests(shop, { email, shopifyCustomerId });
    return requests.map((request) => ({
      id: request.id,
      requestNumber: getDisplayRequestNumber(request),
      submittedDate: request.submittedDate,
      plantsRequested: request.items.map((item) => item.plantName).join(", "),
      status: request.status,
    }));
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);
  await findOrCreateCustomer(shop, DEMO_CUSTOMER);
  const myRequests = await toMyRequestRows(
    DEMO_CUSTOMER.email,
    DEMO_CUSTOMER.shopifyCustomerId,
  )(shop);

  return {
    loggedIn: true,
    name: DEMO_CUSTOMER.name,
    email: DEMO_CUSTOMER.email,
    myRequests,
    showDemoLogin: true,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent !== "submit-request") {
    return { errors: ["Unknown action"], successMessage: null };
  }

  const itemCount = Number(form.get("itemCount") || 0);
  const items: Array<{ plantName: string; notes?: string }> = [];
  for (let index = 0; index < itemCount; index += 1) {
    const plantName = String(form.get(`plantName-${index}`) || "").trim();
    items.push({
      plantName,
      notes: String(form.get(`notes-${index}`) || "").trim() || undefined,
    });
  }

  const errors: string[] = [];
  if (items.length === 0 || items.every((item) => !item.plantName)) {
    errors.push("Add at least one plant with a name.");
  }
  if (items.some((item) => !item.plantName)) {
    errors.push("Each plant row needs a plant name or should be removed.");
  }
  if (errors.length > 0) {
    return { errors, successMessage: null };
  }

  const created = await submitCustomerRequest(shop, {
    ...DEMO_CUSTOMER,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(shop, created.id);

  return {
    errors: [],
    successMessage: `Request submitted. Your request number is ${created.requestNumber}. We'll notify you when matching plants become available.`,
  };
};

export default function CustomerRequestForm() {
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
      requestDetailHref={(requestId) =>
        `/app/customer-offer-preview?requestId=${requestId}`
      }
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
