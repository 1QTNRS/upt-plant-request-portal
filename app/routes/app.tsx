import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { requireAdmin, isDevAdminBypass } from "../lib/admin-auth.server";
import { grantedScopeWarning } from "../lib/env.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await requireAdmin(request);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    embedded: !isDevAdminBypass(),
    scopeWarning: grantedScopeWarning(session?.scope),
  };
};

export default function App() {
  const { apiKey, embedded, scopeWarning } = useLoaderData<typeof loader>();

  const banner = scopeWarning ? (
    <s-section>
      <s-banner tone="critical" heading="Missing Shopify permissions">
        <s-text>{scopeWarning}</s-text>
      </s-banner>
    </s-section>
  ) : null;

  const nav = (
    <s-app-nav>
      <s-link href="/app">Dashboard</s-link>
      <s-link href="/app/exact-plants">EXACT PLANTS</s-link>
      <s-link href="/app/analytics">Analytics</s-link>
      <s-link href="/app/customer-request-form">Request Form</s-link>
      <s-link href="/app/customer-offer-preview">Offer Preview</s-link>
      <s-link href="/app/settings">Settings</s-link>
      <s-link href="/app/help">Help</s-link>
    </s-app-nav>
  );

  if (!embedded) {
    return (
      <AppProvider>
        <div
          style={{
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            padding: "12px 16px",
            borderBottom: "1px solid #e1e3e5",
          }}
        >
          <s-link href="/app">Dashboard</s-link>
          <s-link href="/app/exact-plants">EXACT PLANTS</s-link>
          <s-link href="/app/analytics">Analytics</s-link>
          <s-link href="/app/customer-request-form">Request Form</s-link>
          <s-link href="/app/customer-offer-preview">Offer Preview</s-link>
          <s-link href="/app/settings">Settings</s-link>
          <s-link href="/app/help">Help</s-link>
        </div>
        {banner}
        <Outlet />
      </AppProvider>
    );
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      {nav}
      {banner}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
