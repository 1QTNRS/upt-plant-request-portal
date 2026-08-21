import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";

import {
  CustomerRequestPortal,
  EMPTY_PLANT_LINE,
} from "../components/customer-request-portal";
import { loadCustomerPortal } from "../lib/customer-portal.server";
import {
  portalHome,
  readPlantLines,
  withExtraRow,
  withoutRow,
} from "../lib/customer-portal";
import {
  canUseDemoCustomerLogin,
  destroyCustomerSession,
  serializeCustomerSession,
} from "../lib/customer-session.server";
import { resolveCustomerIdentity } from "../lib/customer-identity.server";
import { notifyNewRequest } from "../lib/emails.server";
import { submitCustomerRequest } from "../lib/portal.server";

/**
 * The customer request form's POST target.
 *
 * A dedicated path rather than the index route's `?index`: React Router removes
 * `index` from the request URL before a loader sees it, so Shopify would sign a
 * query string containing `index` that the app then verifies without it, and
 * every proxied submission would fail its HMAC check and look signed out.
 *
 * Adding and removing a plant row renders here. A successful submission
 * redirects back to the portal, so the customer always lands on
 * https://<shop>/apps/plant-requests and a refresh cannot resubmit.
 */

const DEMO_CUSTOMER = {
  name: "Alex Rivera",
  email: "alex.rivera@example.com",
  shopifyCustomerId: "demo-customer-alex",
};

// React Router re-runs loaders as GETs after an action, so this cannot redirect
// plain GETs without also breaking the add/remove round-trip. Rendering the form
// for a direct visit is harmless; nothing links here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { portal } = await loadCustomerPortal(request);
  return portal;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { context } = await loadCustomerPortal(request);
  const home = portalHome(context);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "add-plant") {
    return { errors: [], plantLines: withExtraRow(readPlantLines(form)) };
  }

  const removeMatch = intent.match(/^remove-plant-(\d+)$/);
  if (removeMatch) {
    return {
      errors: [],
      plantLines: withoutRow(readPlantLines(form), Number(removeMatch[1])),
    };
  }

  if (intent === "demo-login") {
    if (!canUseDemoCustomerLogin()) {
      return { errors: ["Customer login is not available."], plantLines: null };
    }
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      await serializeCustomerSession({ shop: context.shop, ...DEMO_CUSTOMER }),
    );
    throw redirect(home, { headers });
  }

  if (intent === "logout") {
    const headers = new Headers();
    headers.append("Set-Cookie", await destroyCustomerSession());
    throw redirect(home, { headers });
  }

  if (!context.identity) {
    return { errors: ["Please log in to submit a request."], plantLines: null };
  }

  const identity = await resolveCustomerIdentity(context.shop, context.identity);
  if (!identity.email.trim()) {
    return {
      errors: [
        "We could not read the email address on your customer account. Please contact us so we can take your request.",
      ],
      plantLines: readPlantLines(form),
    };
  }

  const submitted = readPlantLines(form);
  const items = submitted.map((line) => ({
    plantName: line.plantName.trim(),
    notes: line.notes.trim() || undefined,
  }));

  const errors: string[] = [];
  if (items.filter((item) => item.plantName).length === 0) {
    errors.push("Add at least one plant with a name.");
  }
  if (items.some((item) => !item.plantName)) {
    errors.push("Each plant row needs a plant name or should be removed.");
  }
  // Keep what was typed so a validation error does not clear the form.
  if (errors.length > 0) return { errors, plantLines: submitted };

  const created = await submitCustomerRequest(context.shop, {
    name: identity.name,
    email: identity.email,
    shopifyCustomerId: identity.shopifyCustomerId,
    items: items.filter((item) => item.plantName),
  });
  await notifyNewRequest(context.shop, created.id);

  throw redirect(`${home}?submitted=${encodeURIComponent(created.requestNumber)}`);
};

export default function CustomerRequestSubmit() {
  const portal = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CustomerRequestPortal
      loggedIn={portal.loggedIn}
      name={portal.name}
      email={portal.email}
      myRequests={portal.myRequests}
      successMessage={null}
      errors={
        actionData?.errors?.length
          ? actionData.errors
          : portal.identityError
            ? [portal.identityError]
            : undefined
      }
      showDemoLogin={portal.showDemoLogin}
      requestDetailHref={(requestId) =>
        `${portal.requestDetailBase}/requests/${requestId}`
      }
      formAction={portal.formAction}
      plantLines={actionData?.plantLines ?? [EMPTY_PLANT_LINE]}
      canSubmit={portal.canSubmitRequests}
    />
  );
}
