# syntax=docker/dockerfile:1
FROM node:26.5.0-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS base
WORKDIR /m

ENV CI=true \
    HOME=/home/app \
    PNPM_HOME=/home/app/.pnpm \
    XDG_DATA_HOME=/home/app/.local/share \
    XDG_CACHE_HOME=/home/app/.cache \
    XDG_CONFIG_HOME=/home/app/.config
RUN npm install -g pnpm@11.9.0 \
    && mkdir -p /home/app/store \
    && printf 'store-dir=/home/app/store\n' > /home/app/.npmrc

FROM base AS dev
ARG LOCAL_UID=1000
ARG LOCAL_GID=1000

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@directory/cli..." build
# Only generated output and caches are writable; source binds stay read-only.
RUN mkdir -p /m/packages/config/dist /m/apps/web/.svelte-kit \
        /m/apps/web/node_modules/.vite /m/apps/web/node_modules/.vite-temp \
    && chown -R ${LOCAL_UID}:${LOCAL_GID} /home/app /m/packages/config/dist \
        /m/apps/web/.svelte-kit /m/apps/web/node_modules/.vite /m/apps/web/node_modules/.vite-temp
USER ${LOCAL_UID}:${LOCAL_GID}
WORKDIR /m/apps/web
EXPOSE 5173
CMD ["sh", "-c", "pnpm --filter @directory/config build && exec node_modules/.bin/vite --host 0.0.0.0 --port 5173 --strictPort"]

FROM base AS builder

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@directory/web..." build

FROM builder AS pruner

# Legacy deploy otherwise leaves a workspace self-link outside the runtime.
RUN --mount=type=cache,id=pnpm-store,target=/home/app/store \
    pnpm --config.hoist-workspace-packages=false --filter @directory/web --prod deploy --legacy /pruned

FROM node:26.5.0-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS prod
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CONFIG_PATH=/app/config/directory.yaml \
    DIRECTORY_PUBLIC_DIR=/app/public
COPY --from=pruner /pruned/build /app/build
COPY --from=pruner /pruned/node_modules /app/node_modules
COPY --from=pruner /pruned/package.json /app/package.json
RUN mkdir -p /app/config /app/public
USER node
EXPOSE 3000
CMD ["node", "/app/build/index.js"]
