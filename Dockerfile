FROM node:24-slim AS deps
WORKDIR /app
RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXTAUTH_SECRET=build-placeholder
ENV DB_PATH=/data/familychart.db
RUN --mount=type=cache,id=next-build,target=/app/.next/cache \
    npm run build
RUN npx esbuild@0.25 scripts/fc-db-convert-cli.ts \
    --bundle --platform=node --format=cjs \
    --external:better-sqlite3-multiple-ciphers \
    --outfile=fc-db-convert.cjs
RUN npx esbuild@0.25 scripts/fc-create-admin-cli.ts \
    --bundle --platform=node --format=cjs \
    --external:better-sqlite3-multiple-ciphers \
    --outfile=fc-create-admin.cjs

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/fc-db-convert.cjs ./fc-db-convert.cjs
COPY --from=builder /app/fc-create-admin.cjs ./fc-create-admin.cjs
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server.js"]
