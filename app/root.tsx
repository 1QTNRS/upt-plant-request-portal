import type { LoaderFunctionArgs } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import { requestLooksLikeAppProxy } from "./lib/customer-nav";

export async function loader({ request }: LoaderFunctionArgs) {
  return { embedInShopTheme: requestLooksLikeAppProxy(request.url) };
}

export default function App() {
  const { embedInShopTheme } = useLoaderData<typeof loader>();

  // Shopify only injects the shop theme around an app-proxy response when the
  // body is a fragment with Content-Type application/liquid. A full HTML
  // document is shown as a standalone page with no store header or menu.
  // {% raw %} keeps customer-typed {{ / {% from being evaluated as Liquid.
  if (embedInShopTheme) {
    return (
      <>
        {"{% raw %}"}
        <Outlet />
        {"{% endraw %}"}
      </>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
