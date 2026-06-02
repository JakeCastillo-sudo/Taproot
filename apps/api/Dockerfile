# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first — leverage Docker layer cache
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

# Install all deps (including dev) for build
RUN npm ci --workspace=@taproot/api --workspace=@taproot/shared

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared types first, then API
RUN npm run build --workspace=@taproot/shared
RUN npm run build --workspace=@taproot/api


# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

# Copy manifests
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/

# Production dependencies only
RUN npm ci --omit=dev --workspace=@taproot/api --workspace=@taproot/shared \
    && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist    ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Create uploads directory
RUN mkdir -p ./apps/api/uploads

# Security: non-root user
RUN addgroup -S taproot && adduser -S taproot -G taproot \
    && chown -R taproot:taproot /app
USER taproot

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
