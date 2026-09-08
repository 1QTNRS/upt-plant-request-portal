/**
 * Production server.
 *
 * This replaces `react-router-serve` for one reason: React Router 7.12 rejects
 * any form submission whose `Origin` header does not match the host in
 * `request.url`, and Shopify's app proxy always produces that mismatch. The
 * storefront page lives on the shop's domain, Shopify forwards the request to
 * the app's own hostname, and React Router aborted every proxied POST with a
 * bare "Bad Request" before a route ever ran — so a customer could open the
 * portal but never submit a request or answer an offer.
 *
 * The framework's own escape hatch (`allowedActionOrigins`) is a static,
 * build-wide list. It cannot express "this shop's storefront", and widening it
 * would relax the same check for the embedded admin routes, where the merchant's
 * session cookie is exactly what cross-site protection is there for. So the
 * origin is withheld for app-proxy requests only, and handed to the app, which
 * is the one place that can verify Shopify's signature and know the shop's
 * storefront domains. See `forwardedOriginIsTrusted` in
 * `app/lib/customer-session.server.ts`.
 *
 * Embedded admin mutations have a second, documented mismatch: Shopify Admin
 * initiates `POST /app/*.data` with `Origin: https://admin.shopify.com` while
 * `request.url` is the app host. React Router's `singleFetchAction` then
 * returns `Error: Bad Request` / 400 *before any route runs* — including
 * Settings token create. A browser will only send that Origin from a page on
 * admin.shopify.com, so we withhold it for `/app` mutations only.
 * `authenticate.admin` still has to accept the request. Do not add
 * `admin.shopify.com` to `allowedActionOrigins`.
 *
 * Render terminates TLS in front of this process. Without `trust proxy`,
 * Express builds `request.url` as `http://…` while the browser Origin is
 * `https://…`, which is the same 400.
 *
 * Everything else mirrors `react-router-serve`: compression, the same static
 * asset routes, and `morgan("tiny")` request logs.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

/**
 * Kept in step with `app/lib/app-proxy.ts` by
 * `app/lib/app-proxy-origin.test.ts`; this file cannot import the app's
 * TypeScript, and a silent drift here would look exactly like the bug it fixes.
 */
export const APP_PROXY_ORIGIN_HEADER = "x-shopify-app-proxy-origin";
export const APP_PROXY_TARGET_PATH = "/customer";
export const SHOPIFY_ADMIN_ORIGIN_HEADER = "x-shopify-admin-origin";
export const EMBEDDED_ADMIN_PATH = "/app";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Query parameters whose values may be written to the request log.
 *
 * Everything else is redacted, because the default `morgan("tiny")` URL is a
 * credential leak here. A proxied storefront URL carries `signature` and
 * `logged_in_customer_id`; replaying a captured one returned that customer's
 * request list an hour later. The embedded admin sends `id_token`, a signed
 * merchant session token. The customer's own typed values travel in the query
 * string too — the add/remove-plant round trips put plant names and notes
 * there — and none of that belongs in a log either.
 *
 * An allow list rather than a deny list: a parameter added later is redacted by
 * default instead of leaking until someone notices.
 */
const LOGGABLE_PARAMS = new Set([
  "shop",
  "path_prefix",
  "embedded",
  "index",
  "submitted",
  "addPlant",
  "removePlant",
  "itemCount",
  "_routes",
  "_data",
]);

/** The request URL with every sensitive value replaced, keys kept. */
export function redactUrl(url) {
  const [pathname, query] = url.split("?");
  if (!query) return pathname;

  const redacted = [...new URLSearchParams(query)]
    .map(([key, value]) =>
      LOGGABLE_PARAMS.has(key) ? `${key}=${value}` : `${key}=[redacted]`,
    )
    .join("&");
  return `${pathname}?${redacted}`;
}

function isAppProxyTarget(url) {
  const pathname = url.split("?")[0];
  return (
    pathname === APP_PROXY_TARGET_PATH ||
    pathname.startsWith(`${APP_PROXY_TARGET_PATH}/`) ||
    // Single-fetch data requests, e.g. /customer/submit.data
    pathname.startsWith(`${APP_PROXY_TARGET_PATH}.`)
  );
}

export function isEmbeddedAdminPath(url) {
  const pathname = url.split("?")[0];
  return (
    pathname === EMBEDDED_ADMIN_PATH ||
    pathname.startsWith(`${EMBEDDED_ADMIN_PATH}/`) ||
    pathname.startsWith(`${EMBEDDED_ADMIN_PATH}.`)
  );
}

/** Hostname of an Origin header. Mirrors `originHost` in app-proxy.ts. */
export function adminOriginHost(origin) {
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isShopifyAdminOrigin(origin) {
  const host = adminOriginHost(origin);
  if (!host) return false;
  return host === "admin.shopify.com" || host.endsWith(".admin.shopify.com");
}

/**
 * Moves Shopify Admin's Origin aside so React Router's single-fetch CSRF
 * check does not abort embedded `/app` mutations with a bare 400.
 *
 * Only `admin.shopify.com` (and its subdomains) are withheld. An attacker
 * page cannot set that Origin. The internal header is deleted first so a
 * caller cannot choose it.
 */
export function withholdShopifyAdminOrigin(req) {
  delete req.headers[SHOPIFY_ADMIN_ORIGIN_HEADER];

  if (!MUTATION_METHODS.has(req.method)) return;
  if (!isEmbeddedAdminPath(req.url)) return;

  const origin = req.headers.origin;
  if (!isShopifyAdminOrigin(origin)) return;

  req.headers[SHOPIFY_ADMIN_ORIGIN_HEADER] = origin;
  delete req.headers.origin;
}

function logAdminMutationOrigin(req) {
  if (!MUTATION_METHODS.has(req.method)) return;
  if (!isEmbeddedAdminPath(req.url)) return;

  const pathname = req.url.split("?")[0];
  const forwarded = req.headers[SHOPIFY_ADMIN_ORIGIN_HEADER];
  const origin = req.headers.origin || forwarded;
  console.info(
    `[upt-portal] admin-mutation path=${pathname} origin_host=${adminOriginHost(origin) || "none"} withheld=${forwarded ? "yes" : "no"}`,
  );
}

/**
 * Moves the storefront `Origin` of a proxied submission aside so React Router's
 * cross-origin check does not abort it, leaving the decision to the app.
 *
 * Only requests Shopify claims to have signed are touched, and only on the
 * route the app proxy forwards to. The internal header is deleted from every
 * request first: without that, a caller could set it and choose which origin the
 * app vets.
 */
export function withholdAppProxyOrigin(req) {
  delete req.headers[APP_PROXY_ORIGIN_HEADER];

  if (!MUTATION_METHODS.has(req.method)) return;
  if (!isAppProxyTarget(req.url)) return;
  if (!req.url.includes("signature=")) return;

  const origin = req.headers.origin;
  if (!origin) return;

  req.headers[APP_PROXY_ORIGIN_HEADER] = origin;
  delete req.headers.origin;
}

async function start() {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

  const buildPath = path.resolve("build/server/index.js");
  const build = await import(pathToFileURL(buildPath).href);
  const port = Number(process.env.PORT) || 3000;

  const app = express();
  app.disable("x-powered-by");
  // Render's load balancer terminates TLS. React Router builds request.url
  // from req.protocol; without this, https Origins fail the CSRF check.
  app.set("trust proxy", 1);
  app.use(compression());

  app.use(
    path.posix.join(build.publicPath, "assets"),
    express.static(path.join(build.assetsBuildDirectory, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(build.publicPath, express.static(build.assetsBuildDirectory));
  app.use(express.static("public", { maxAge: "1h" }));

  morgan.token("redacted-url", (req) => redactUrl(req.originalUrl || req.url));
  app.use(
    morgan(
      ":method :redacted-url :status :res[content-length] - :response-time ms",
    ),
  );

  app.use((req, _res, next) => {
    withholdAppProxyOrigin(req);
    withholdShopifyAdminOrigin(req);
    logAdminMutationOrigin(req);
    next();
  });

  app.all(
    "*",
    createRequestHandler({ build, mode: process.env.NODE_ENV }),
  );

  const onListen = () => console.log(`[upt-portal] listening on port ${port}`);
  const server = process.env.HOST
    ? app.listen(port, process.env.HOST, onListen)
    : app.listen(port, onListen);

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => server?.close(console.error));
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await start();
