FROM node:26.5.0-alpine AS builder
WORKDIR /m

ENV CI=true
RUN npm install -g pnpm@11.9.0 \
    && pnpm config set store-dir /pnpm/store

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter "@directory/cli..." build

FROM node:26.5.0-alpine AS prod
WORKDIR /app

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config/directory.yaml
COPY --from=builder /m/apps/cli/dist/index.js /app/directory-cli.js
RUN mkdir -p /app/config
USER node
ENTRYPOINT ["node", "/app/directory-cli.js"]
