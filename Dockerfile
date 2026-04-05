# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Copy source and compile TypeScript
COPY . .
# Run prisma generate before build to ensure PrismaClient exists for TypeScript
RUN npx prisma generate
RUN npm run build

# ─── Stage 2: Production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install production deps only (smaller image)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Copy Prisma schema for migrations and generated client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

# Default command: Runs migrations first, and if successful, starts the API server
# Note: nest build outputs to dist/src/ because tsconfig.json baseUrl is ./
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
