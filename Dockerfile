# syntax=docker/dockerfile:1
# The production image (docs/deploy.md): `next start` on port 3000. Node 24 as in CI; pnpm from package.json's
# packageManager through corepack. Full install kept on purpose: the release step (prisma migrate deploy, prisma db seed)
# runs from this same image, and prisma and pg are devDependencies. No secret goes in: everything comes at run time.

FROM node:24-slim AS base
# openssl: Prisma's schema engine (migrate deploy) needs libssl. tini: PID 1, passes SIGTERM on so `next start` drains.
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Dependencies first, so a source-only change reuses this layer. postinstall runs `prisma generate` (needs the schema).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma/schema.prisma prisma/
RUN pnpm install --frozen-lockfile
COPY . .
# Inlined into the client bundle by `next build`: a new key means a new image. Public, not a secret.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN pnpm build

FROM base
# The same public key at run time, so the server's push sender and env check (src/lib/env.ts) see what the client has.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NODE_ENV=production PORT=3000 PATH=/app/node_modules/.bin:$PATH NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Files stay root's: the app user can only write Next's cache.
COPY --from=build --exclude=.next/cache /app /app
RUN mkdir .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["next", "start"]
