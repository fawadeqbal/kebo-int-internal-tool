# syntax=docker/dockerfile:1
# The web app (Next.js standalone) with Chromium for PDF documents.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable && corepack prepare pnpm@10.18.0 --activate

FROM base AS prune
WORKDIR /repo
COPY . .
RUN npx -y turbo@2.11.10 prune @kebo/web --docker

FROM base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@kebo/web...

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 CHROME_PATH=/usr/bin/chromium
RUN apk add --no-cache tini chromium font-noto font-noto-cjk font-liberation && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/login || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
