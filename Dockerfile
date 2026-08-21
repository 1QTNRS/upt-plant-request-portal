# Production image. `app/lib/env.server.ts` refuses to start in production on a
# SQLite DATABASE_URL, so this image targets PostgreSQL only: the Prisma client
# is generated for PostgreSQL at build time and the container never has to write
# to node_modules at runtime.

# Build stage: needs devDependencies for the React Router (Vite) build.
FROM node:22-alpine AS build

RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
# No lockfile is committed, so `npm ci` cannot be relied on here.
RUN npm install --no-audit --no-fund

COPY . .
RUN npx prisma generate --schema prisma/postgres/schema.prisma \
  && npm run build


# Runtime stage: production dependencies plus the built output.
FROM node:22-alpine AS runtime

# Prisma's query engine needs openssl; wget is used by the healthcheck.
RUN apk add --no-cache openssl wget
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

# Override with a durable database at run time. The default writes inside the
# container, so it is wiped on every redeploy.
ENV DATABASE_URL="file:dev.sqlite"

COPY package.json package-lock.json* ./
# `prisma` and `@prisma/client` are production dependencies, so the Prisma CLI is
# available at start for `migrate deploy`.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY prisma ./prisma
COPY scripts ./scripts
RUN npx prisma generate --schema prisma/postgres/schema.prisma \
  && npm cache clean --force

COPY --from=build /app/build ./build
COPY public ./public

# The app writes nothing to disk in production — photos go to Shopify Files.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

# Applies pending migrations, then serves. Migrations run at start rather than at
# build time because the database is only reachable from the deployment target.
CMD ["npm", "run", "docker-start"]
