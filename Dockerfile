# Milestone 1 foundation; full container/redeploy verification is Milestone 9.
FROM node:24.22.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY engine ./engine
RUN npm run build

FROM node:24.22.1-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/start.mjs ./scripts/start.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then(async r => { if (!r.ok || (await r.json()).status !== 'ready') process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "scripts/start.mjs"]
