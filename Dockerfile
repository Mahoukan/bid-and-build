# npm must support the lockfile's explicit allowScripts policy.
FROM node:24.22.1-bookworm-slim AS base
RUN npm install --global npm@11.19.1 && npm cache clean --force

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY engine ./engine
COPY samples ./samples
RUN npm run build

FROM base AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts/start.mjs ./scripts/start.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then(async r => { if (!r.ok || (await r.json()).status !== 'ready') process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "scripts/start.mjs"]
