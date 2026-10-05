# syntax=docker/dockerfile:1

# --- Tahap build: kompilasi TypeScript ---
FROM node:20-alpine AS build
WORKDIR /app
# npm ci memakai lockfile supaya versi dependency identik dengan hasil uji.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- Tahap dependency runtime: hanya dependency produksi (ws) ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Tahap runtime: image kecil, user non-root ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
# wget dipakai HEALTHCHECK; node:20-alpine sudah menyediakannya lewat busybox.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# `node` (uid 1000) sudah ada di image resmi; tidak membuat user baru.
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/index.js"]
