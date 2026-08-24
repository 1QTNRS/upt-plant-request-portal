import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";

import {
  CustomerOfferView,
  CustomerSupportNote,
} from "../components/customer-offer-view";
import { CustomerEnhanceScripts } from "../components/customer-enhance";
import { CustomerPageShell, StatusBadge } from "../components/theme";
import { CustomerLoginLink } from "../components/customer-request-portal";
import { customerPortalRelativeLinks } from "../lib/app-proxy";
import { shopifyCustomerLoginHref } from "../lib/customer-nav";
import {
  fedexRemovalNeedsConfirmation,
  readOfferChoices,
} from "../lib/customer-portal";
import { readCustomerContext } from "../lib/customer-session.server";
import { resolveCustomerIdentity } from "../lib/customer-identity.server";
import { identityOwnsRequest } from "../lib/customer-identity";
import {
  customerStatusTone,
  formatCustomerStatusLabel,
  getDisplayRequestNumber,
  shouldRenderCustomerSupportNote,
} from "../lib/portal";
import {
  handleCustomerOfferAction,
  loadCustomerOfferPage,
} from "../lib/offer-response.server";
import { formatCustomerDateTime } from "../lib/customer-time";
import {
  getCustomerTimeZone,
  getRequest,
  saveCustomerTimeZone,
} from "../lib/portal.server";
import { offlineAdminClient } from "../lib/offline-admin.server";
import { ensureShopSeeded } from "../lib/seed-demo.server";


/**
 * Resolves the visitor and confirms they own the request, or returns null so
 * the caller can render the same "not available" response for a missing
 * request, a forged id and someone else's request.
 */
async function authorizeRequest(request: Request, requestId: string) {
  const context = await readCustomerContext(request);
  if (!context) return null;

  // Never seeds a real shop; keeps the settings row present for one.
  await ensureShopSeeded(context.shop);

  if (!context.identity) return null;
  const identity = await resolveCustomerIdentity(context.shop, context.identity);
  const plantRequest = await getRequest(context.shop, requestId);
  if (!identityOwnsRequest(identity, plantRequest)) return null;

  return { context, plantRequest };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const requestId = params.id ?? "";
  const authorized = await authorizeRequest(request, requestId);

  if (!authorized) {
    const context = await readCustomerContext(request);
    const viaAppProxy = context?.viaAppProxy ?? false;
    const links = customerPortalRelativeLinks(viaAppProxy);
    const returnPath = requestId ? links.requestDetail(requestId) : links.home;
    return {
      forbidden: true as const,
      request: null,
      offer: null,
      response: null,
      invoiceUrl: null,
      fedexRemovalWarning: "",
      requestClosed: false,
      requestPaid: false,
      requestStatus: null,
      paidAt: null,
      paidAtIso: null,
      customerTimeZone: null,
      backHref: links.home,
      loginHref: viaAppProxy ? shopifyCustomerLoginHref(returnPath) : null,
      formAction: "",
      statusLabel: "",
      submittedAt: "",
    };
  }

  const { context, plantRequest } = authorized;
  const admin = await offlineAdminClient(context.shop);
  const page = await loadCustomerOfferPage(context.shop, requestId, admin);
  const links = customerPortalRelativeLinks(context.viaAppProxy);
  const customerTimeZone = plantRequest
    ? await getCustomerTimeZone(context.shop, plantRequest.email)
    : null;
  return {
    forbidden: false as const,
    request: plantRequest,
    ...page,
    // The same derived label the customer's request list shows. Stored statuses
    // stay New / Pending / Closed / Expired.
    statusLabel: plantRequest
      ? formatCustomerStatusLabel(plantRequest.status, {
          hasPayableItems: plantRequest.hasPayableItems,
          hasResponded: plantRequest.hasResponded,
        })
      : "",
    backHref: links.home,
    loginHref: null as string | null,
    // The storefront path for this page. React Router would otherwise render
    // the app's own /customer/requests/:id, which 404s on the shop's domain.
    formAction: links.requestDetail(requestId),
    customerTimeZone,
    submittedAt: plantRequest
      ? formatCustomerDateTime(new Date(plantRequest.submittedAtIso), customerTimeZone)
      : "",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const requestId = params.id ?? "";
  const authorized = await authorizeRequest(request, requestId);
  if (!authorized) throw data("Not found", { status: 404 });

  const { context, plantRequest } = authorized;
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (plantRequest) {
    await saveCustomerTimeZone(
      context.shop,
      plantRequest.email,
      form.get("customerTimeZone"),
    );
  }
  if (intent === "save-timezone") {
    return {
      ok: true as const,
      pendingFedexRemoval: false,
      submittedChoices: {},
      fedexSelected: true,
      error: null as string | null,
    };
  }
  const choices = readOfferChoices(form);

  // Keeping the upgrade returns to the form with it checked again.
  if (intent === "keep-fedex") {
    return {
      ok: false as const,
      pendingFedexRemoval: false,
      submittedChoices: choices,
      fedexSelected: true,
      error: null as string | null,
    };
  }

  // Removing the upgrade has to be confirmed against the warning from Settings.
  // The modal that used to do this never opens on the storefront, so it becomes
  // a second round-trip that carries the customer's choices forward.
  if (
    intent === "submit-response" &&
    fedexRemovalNeedsConfirmation({
      choices,
      fedexSelected: String(form.get("fedexUpgradeSelected")) === "true",
      acknowledged: String(form.get("fedexRemovalAcknowledged")) === "true",
    })
  ) {
    return {
      ok: false as const,
      pendingFedexRemoval: true,
      submittedChoices: choices,
      fedexSelected: false,
      error: null as string | null,
    };
  }

  // The portal is served through the app proxy and so has no merchant session;
  // the stored offline token is what lets an accepted offer become a real
  // Shopify draft order.
  const admin = await offlineAdminClient(context.shop);
  const result = await handleCustomerOfferAction({
    shop: context.shop,
    requestId,
    form,
    admin,
  });
  if (result.ok && "closed" in result && result.closed) {
    throw redirect(customerPortalRelativeLinks(context.viaAppProxy).home);
  }
  return {
    error: null as string | null,
    ...result,
    pendingFedexRemoval: false,
    submittedChoices: choices,
  };
};

export default function CustomerRequestDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (data.forbidden) {
    return (
      <CustomerPageShell title="Request not available">
        <section className="upt-card">
          <p className="upt-muted">
            You can only view your own plant requests. Please log in with the
            customer account that submitted this request.
          </p>
          {data.loginHref ? <CustomerLoginLink href={data.loginHref} /> : null}
          <p style={{ margin: "16px 0 0" }}>
            <s-link href={data.backHref}>Back to My Requests</s-link>
          </p>
        </section>
      </CustomerPageShell>
    );
  }

  if (!data.offer && data.request) {
    return (
      <CustomerPageShell title={getDisplayRequestNumber(data.request)}>
        <section className="upt-card">
          <h2 className="upt-card-title">Request details</h2>
          <s-stack direction="block" gap="base">
            <StatusBadge
              tone={customerStatusTone(data.request.status, {
                hasPayableItems: data.request.hasPayableItems,
                hasResponded: data.request.hasResponded,
              })}
            >
              {data.statusLabel}
            </StatusBadge>
            <s-text>
              Submitted{" "}
              <time dateTime={data.request.submittedAtIso} data-customer-time>
                {data.submittedAt || data.request.submittedDate}
              </time>
            </s-text>
            <s-text>Requested plants:</s-text>
            {data.request.items.map((item) => (
              <s-text key={item.id}>{item.plantName}</s-text>
            ))}
            <s-text color="subdued">
              We&apos;ll notify you when your personal offer is ready.
            </s-text>
            {shouldRenderCustomerSupportNote({
              status: data.request.status,
              requestClosed: data.request.status === "Closed",
            }) ? (
              <CustomerSupportNote />
            ) : null}
            <s-link href={data.backHref}>Back to My Requests</s-link>
          </s-stack>
        </section>
        <form
          method="post"
          action={data.formAction}
          data-tz-capture
          data-known-tz={data.customerTimeZone ?? ""}
          hidden
        >
          <input type="hidden" name="intent" value="save-timezone" />
          <input type="hidden" name="customerTimeZone" defaultValue="" />
        </form>
        <CustomerEnhanceScripts />
      </CustomerPageShell>
    );
  }

  return (
    <CustomerOfferView
      offer={data.offer}
      response={data.response}
      invoiceUrl={data.invoiceUrl}
      fedexRemovalWarning={data.fedexRemovalWarning}
      statusLabel={data.statusLabel}
      statusTone={
        data.request
          ? customerStatusTone(data.request.status, {
              hasPayableItems: data.request.hasPayableItems,
              hasResponded: data.request.hasResponded,
            })
          : undefined
      }
      backHref={data.backHref}
      requestClosed={data.requestClosed}
      requestPaid={data.requestPaid}
      requestStatus={data.request?.status ?? data.requestStatus}
      paidAt={data.paidAt}
      paidAtIso={data.paidAtIso}
      customerTimeZone={data.customerTimeZone}
      formAction={data.formAction}
      submittedChoices={actionData?.submittedChoices}
      fedexSelected={actionData?.fedexSelected ?? true}
      pendingFedexRemoval={actionData?.pendingFedexRemoval ?? false}
      error={actionData?.error ?? null}
    />
  );
}
