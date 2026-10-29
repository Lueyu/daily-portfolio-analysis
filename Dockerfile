# ---------- Build stage ----------
# ARG BASE_REGISTRY lets users behind a firewall pull through a mirror, e.g.
#   docker compose build --build-arg BASE_REGISTRY=docker.m.daocloud.io/library
ARG BASE_REGISTRY=library
FROM ${BASE_REGISTRY}/node:22-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY package.json package-lock.json .npmrc ./
# The prepare lifecycle script references this file; it must exist before npm ci.
COPY scripts/setup-git-hooks.js scripts/
RUN npm ci

COPY . .
# npm run build = nest build (dist/server) + vite build (dist/client).
RUN npm run build

# ---------- Runtime stage ----------
FROM ${BASE_REGISTRY}/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000

COPY package.json package-lock.json .npmrc ./
COPY scripts/setup-git-hooks.js scripts/
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Views and static assets are resolved from process.cwd()/dist/client
# (server/main.ts), so the working directory must stay /app.
CMD ["node", "dist/server/main.js"]
