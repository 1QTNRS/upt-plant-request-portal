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

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAppProxyTarget(url) {
  const pathname = url.split("?")[0];
  return (
    pathname === APP_PROXY_TARGET_PATH ||
    pathname.startsWith(`${APP_PROXY_TARGET_PATH}/`) ||
    // Single-fetch data requests, e.g. /customer/submit.data
    pathname.startsWith(`${APP_PROXY_TARGET_PATH}.`)
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
  app.use(morgan("tiny"));

  app.use((req, _res, next) => {
    withholdAppProxyOrigin(req);
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
