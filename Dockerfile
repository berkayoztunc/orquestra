# Dockerfile for orquestra

FROM oven/bun:latest AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/
COPY packages/frontend/package.json ./packages/frontend/
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun run build

# Production stage
FROM oven/bun:latest

WORKDIR /app

# Copy only necessary files
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/worker/package.json ./packages/worker/
COPY packages/frontend/package.json ./packages/frontend/
RUN bun install --frozen-lockfile --production

# Copy built files from builder
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/src ./packages/shared/src

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:8787/health'); if (!r.ok) throw new Error(r.status)"

EXPOSE 8787

CMD ["bun", "run", "packages/worker/src/index.ts"]
