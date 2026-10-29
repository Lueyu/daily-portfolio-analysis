# ---------- Build stage ----------
# ARG BASE_REGISTRY lets users behind a firewall pull through a mirror, e.g.
#   docker compose build --build-arg BASE_REGISTRY=docker.m.daocloud.io/library
ARG BASE_REGISTRY=library
FROM ${BASE_REGISTRY}/node:22-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY package.json package-lock.json .npmrc ./
COPY scripts/postinstall.js scripts/setup-git-hooks.js scripts/
RUN npm ci

COPY . .
# build:prod = nest build (dist/server) + vite build (dist/client).
# CLIENT_BASE_PATH must be set inline: the vite preset otherwise defaults the
# SPA router basename to the platform app prefix (/app/<appId>) and the Router
# renders nothing on a self-hosted "/" origin. Inline (not ENV) so this layer
# can never be served from a pre-CLIENT_BASE_PATH build cache.
RUN CLIENT_BASE_PATH=/ npm run build:prod \
  # The vite preset emits the HTML shell at dist/client/client/index.html;
  # the Nest view engine expects it at dist/client/index.html (see main.ts
  # setBaseViewsDir + the platform's public assets middleware).
  && mv dist/client/client/index.html dist/client/index.html \
  && rmdir dist/client/client \
  # The platform core reserves the "assets/" URL prefix for its CDN and will
  # not serve it locally (PLATFORM_PREFIXES in @lark-apaas/fullstack-nestjs-core).
  # Self-hosted builds must expose the hashed bundle under a free prefix.
  && mv dist/client/assets dist/client/spa-assets \
  && sed -i 's|/assets/|/spa-assets/|g' dist/client/index.html \
  && grep -rl '/assets/' dist/client/spa-assets | xargs -r sed -i 's|/assets/|/spa-assets/|g'

# ---------- Runtime stage ----------
FROM ${BASE_REGISTRY}/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000

COPY package.json package-lock.json .npmrc ./
# Lifecycle scripts (postinstall/prepare) reference these; they must exist
# before `npm ci` runs.
COPY scripts/postinstall.js scripts/setup-git-hooks.js scripts/
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Views are resolved from process.cwd()/dist/client (server/main.ts), so the
# working directory must stay /app.
CMD ["node", "dist/server/main.js"]
