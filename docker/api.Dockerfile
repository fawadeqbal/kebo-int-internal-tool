# syntax=docker/dockerfile:1
# The API and the worker (same image, different command).
FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat && corepack enable && corepack prepare pnpm@10.18.0 --activate

# Only the packages the API needs.
FROM base AS prune
WORKDIR /repo
COPY . .
RUN npx -y turbo@2.11.10 prune @kebo/api --docker

FROM base AS build
WORKDIR /app
COPY --from=prune /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN pnpm turbo run build --filter=@kebo/api...

FROM base AS runner
# Kept by the nightly cleanup (deploy/server/docker-cleanup.sh): the :previous image a failed deploy goes back to.
LABEL desk.kebo.keep="true"
WORKDIR /app
ENV NODE_ENV=production UPLOAD_DIR=/data/uploads
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /app .
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Apply database migrations, then start the API (a no-op after deploy/ci-deploy.sh, which applies them
# first; there for a deploy by hand). The worker overrides the command.
CMD ["sh", "-c", "cd /app/packages/database && node scripts/migrate-on-start.mjs && cd /app/apps/api && exec node dist/main.js"]
