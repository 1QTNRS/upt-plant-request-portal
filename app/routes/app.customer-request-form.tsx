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
  type PlantLine,
} from "../components/customer-request-portal";
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
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (!isDemoDataEnabled(shop)) {
    return { errors: [PREVIEW_NOTICE], successMessage: null };
  }

  if (intent === "add-plant") {
    return {
      errors: [],
      successMessage: null,
      plantLines: [...readPlantLines(form), { plantName: "", notes: "" }],
    };
  }

  const removeMatch = intent.match(/^remove-plant-(\d+)$/);
  if (removeMatch) {
    const remaining = readPlantLines(form).filter(
      (_line, index) => index !== Number(removeMatch[1]),
    );
    return {
      errors: [],
      successMessage: null,
      plantLines: remaining.length > 0 ? remaining : [{ plantName: "", notes: "" }],
    };
  }

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

function readPlantLines(form: FormData): PlantLine[] {
  const count = Math.max(1, Math.min(Number(form.get("itemCount") || 1) || 1, 20));
  const lines: PlantLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      plantName: String(form.get(`plantName-${index}`) ?? ""),
      notes: String(form.get(`notes-${index}`) ?? ""),
    });
  }
  return lines;
}

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
      plantLines={actionData?.plantLines ?? [EMPTY_PLANT_LINE]}
      canSubmit={loaderData.previewNotice === null}
    />
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
