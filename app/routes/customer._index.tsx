import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";

import { CustomerRequestPortal } from "../components/customer-request-portal";
import { customerPortalRelativeLinks } from "../lib/app-proxy";
import {
  canUseDemoCustomerLogin,
  destroyCustomerSession,
  readCustomerContext,
  serializeCustomerSession,
} from "../lib/customer-session.server";
import { resolveCustomerIdentity } from "../lib/customer-identity.server";
import { notifyNewRequest } from "../lib/emails.server";
import { getDisplayRequestNumber, type CustomerMyRequestRow } from "../lib/portal";
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

function toRequestRow(
  request: Awaited<ReturnType<typeof listCustomerRequests>>[number],
): CustomerMyRequestRow {
  return {
    id: request.id,
    requestNumber: getDisplayRequestNumber(request),
    submittedDate: request.submittedDate,
    plantsRequested: request.items.map((item) => item.plantName).join(", "),
    status: request.status,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await readCustomerContext(request);
  if (!context) throw data("Not found", { status: 404 });

  // `ensureShopSeeded` refuses anything but a demo shop; this also keeps the
  // settings row in place for a real shop without seeding it.
  await ensureShopSeeded(context.shop);

  const links = customerPortalRelativeLinks(context.viaAppProxy);
  const signedOut = {
    loggedIn: false as const,
    name: "",
    email: "",
    myRequests: [] as CustomerMyRequestRow[],
    showDemoLogin: canUseDemoCustomerLogin(),
    requestDetailBase: links.home,
    canSubmitRequests: false,
    identityError: null as string | null,
  };

  if (!context.identity) return signedOut;

  const identity = await resolveCustomerIdentity(context.shop, context.identity);

  // Without an email the request cannot be attributed or acknowledged, and
  // `CustomerProfile` is keyed on (shop, email) so a blank one would collapse
  // every unidentified shopper into a single shared profile. The customer can
  // still read the requests already linked to their Shopify account id.
  if (!identity.email.trim()) {
    if (!identity.shopifyCustomerId) return signedOut;
    const requests = await listCustomerRequests(context.shop, {
      shopifyCustomerId: identity.shopifyCustomerId,
    });
    return {
      loggedIn: true as const,
      name: identity.name,
      email: "",
      showDemoLogin: canUseDemoCustomerLogin(),
      requestDetailBase: links.home,
      canSubmitRequests: false,
      identityError:
        "We could not read the email address on your store account. Add an email to your account to submit a new plant request.",
      myRequests: requests.map(toRequestRow),
    };
  }

  const customer = await findOrCreateCustomer(context.shop, {
    name: identity.name,
    email: identity.email,
    shopifyCustomerId: identity.shopifyCustomerId,
  });
  const requests = await listCustomerRequests(customer.shop, {
    email: customer.email,
    shopifyCustomerId: customer.shopifyCustomerId ?? undefined,
  });

  return {
    loggedIn: true as const,
    name: customer.name,
    email: customer.email,
    showDemoLogin: canUseDemoCustomerLogin(),
    requestDetailBase: links.home,
    canSubmitRequests: true,
    identityError: null as string | null,
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
  const context = await readCustomerContext(request);
  if (!context) throw data("Not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "demo-login") {
    if (!canUseDemoCustomerLogin()) {
      return { errors: ["Customer login is not available."], successMessage: null };
    }
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      await serializeCustomerSession({ shop: context.shop, ...DEMO_CUSTOMER }),
    );
    throw redirect("/customer", { headers });
  }

  if (intent === "logout") {
    const headers = new Headers();
    headers.append("Set-Cookie", await destroyCustomerSession());
    throw redirect("/customer", { headers });
  }

  if (!context.identity) {
    return { errors: ["Please log in to submit a request."], successMessage: null };
  }

  const identity = await resolveCustomerIdentity(context.shop, context.identity);
  if (!identity.email.trim()) {
    return {
      errors: [
        "We could not read the email address on your customer account. Please contact us so we can take your request.",
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

  const created = await submitCustomerRequest(context.shop, {
    name: identity.name,
    email: identity.email,
    shopifyCustomerId: identity.shopifyCustomerId,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(context.shop, created.id);

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
      errors={
        actionData?.errors?.length
          ? actionData.errors
          : loaderData.identityError
            ? [loaderData.identityError]
            : undefined
      }
      showDemoLogin={loaderData.showDemoLogin}
      requestDetailHref={(requestId) =>
        `${loaderData.requestDetailBase}/requests/${requestId}`
      }
      formAction="?index"
    />
  );
}
