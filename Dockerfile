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
ARG VITE_PUBLIC_DEPLOYMENT=false
ENV VITE_PUBLIC_DEPLOYMENT=${VITE_PUBLIC_DEPLOYMENT}
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
COPY scripts/db/03_agent_builder.sql ./scripts/db/03_agent_builder.sql
COPY scripts/db/04_user_api_settings.sql ./scripts/db/04_user_api_settings.sql
COPY scripts/db/05_analysis_language.sql ./scripts/db/05_analysis_language.sql
COPY scripts/db/06_account_recovery.sql ./scripts/db/06_account_recovery.sql
COPY scripts/db/07_llm_budget.sql ./scripts/db/07_llm_budget.sql
COPY scripts/db/08_investment_council.sql ./scripts/db/08_investment_council.sql
COPY scripts/db/09_builder_cadence.sql ./scripts/db/09_builder_cadence.sql
COPY scripts/ensure-settings-key.cjs scripts/start-app.cjs ./scripts/

# Views and static assets are resolved from process.cwd()/dist/client
# (server/main.ts), so the working directory must stay /app.
CMD ["node", "scripts/start-app.cjs"]
