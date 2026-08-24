import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CustomerLightboxRoot } from "../components/customer-photo-gallery";
import { CustomerPortalNav } from "../components/customer-portal-nav";
import { CustomerSurface, ThemeStyles } from "../components/theme";
import { customerMyRequestsHref, storefrontHomeUrl } from "../lib/customer-nav";
import { readCustomerContext } from "../lib/customer-session.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await readCustomerContext(request);
  const viaAppProxy = context?.viaAppProxy ?? false;
  return {
    storefrontHomeUrl: storefrontHomeUrl({
      shop: context?.shop,
      viaAppProxy,
    }),
    myRequestsHref: customerMyRequestsHref(viaAppProxy),
  };
};

export default function CustomerLayout() {
  const data = useLoaderData<typeof loader>();
  return (
    <CustomerSurface paintDocument>
      <ThemeStyles />
      <AppProvider>
        <CustomerPortalNav
          homeHref={data.storefrontHomeUrl}
          myRequestsHref={data.myRequestsHref}
        />
        <Outlet />
      </AppProvider>
      <CustomerLightboxRoot />
    </CustomerSurface>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
