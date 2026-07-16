# Stage 1: Build stage
FROM node:18-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma

# Install all dependencies (development + production)
RUN npm ci

# Copy source code
COPY . .

# Build application (runs build.js which compiles server.js and runs prisma generate)
RUN npm run build

# Prune devDependencies to leave only production dependencies in node_modules
RUN npm prune --omit=dev

# Stage 2: Production runner stage
FROM node:18-slim AS runner

# Install openssl for Prisma compatibility
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy built application and pruned node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
