import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  CustomerRequestPortal,
  EMPTY_PLANT_LINE,
} from "../components/customer-request-portal";
import { plantLinesFromQuery, readPlantLines } from "../lib/customer-portal";
import { requireAdmin } from "../lib/admin-auth.server";
import { isDemoDataEnabled } from "../lib/environment.server";
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

const PREVIEW_NOTICE =
  "Preview only. This is what customers see at /apps/plant-requests. Requests submitted here would be attributed to a demo account, so submission is disabled outside development.";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  await ensureShopSeeded(shop);

  // The demo customer is a development fixture. Creating it on a merchant shop
  // would put a fake shopper and fake requests in the live dashboard.
  if (!isDemoDataEnabled(shop)) {
    return {
      loggedIn: true,
      name: DEMO_CUSTOMER.name,
      email: DEMO_CUSTOMER.email,
      myRequests: [] as CustomerMyRequestRow[],
      showDemoLogin: false,
      previewNotice: PREVIEW_NOTICE as string | null,
      plantLines: plantLinesFromQuery(new URL(request.url).searchParams),
    };
  }

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
    previewNotice: null as string | null,
    plantLines: plantLinesFromQuery(new URL(request.url).searchParams),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (!isDemoDataEnabled(shop)) {
    return { errors: [PREVIEW_NOTICE], successMessage: null, plantLines: null };
  }

  if (intent !== "submit-request") {
    return { errors: ["Unknown action"], successMessage: null, plantLines: null };
  }

  const submitted = readPlantLines(form);
  const items = submitted.map((line) => ({
    plantName: line.plantName.trim(),
    notes: line.notes.trim() || undefined,
  }));

  const errors: string[] = [];
  if (items.every((item) => !item.plantName)) {
    errors.push("Add at least one plant with a name.");
  }
  if (items.some((item) => !item.plantName)) {
    errors.push("Each plant row needs a plant name or should be removed.");
  }
  if (errors.length > 0) {
    return { errors, successMessage: null, plantLines: submitted };
  }

  const created = await submitCustomerRequest(shop, {
    ...DEMO_CUSTOMER,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(shop, created.id);

  return {
    errors: [],
    plantLines: null,
    successMessage: `Request submitted. Your request number is ${created.requestNumber}. We'll notify you when matching plants become available.`,
  };
};

export default function CustomerRequestForm() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const errors = actionData?.errors?.length
    ? actionData.errors
    : loaderData.previewNotice
      ? [loaderData.previewNotice]
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
      requestDetailHref={(requestId) =>
        `/app/customer-offer-preview?requestId=${requestId}`
      }
      formAction="/app/customer-request-form"
      browseAction="/app/customer-request-form"
      plantLines={
        actionData?.plantLines ?? loaderData.plantLines ?? [EMPTY_PLANT_LINE]
      }
      canSubmit={loaderData.previewNotice === null}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
