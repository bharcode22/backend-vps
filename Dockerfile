# Stage 1: Build stage
FROM node:18-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma

# Install all dependencies (development + production)
RUN npm ci

# Generate Prisma client for building
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Production runner stage
FROM node:18-slim AS runner

# Install openssl for Prisma compatibility
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and prisma directory
COPY package*.json ./
COPY prisma ./prisma

# Install only production dependencies
RUN npm ci --omit=dev

# Regenerate Prisma Client in production context
RUN npx prisma generate

# Copy built app files from build stage
COPY --from=builder /app/dist ./dist

# Expose server port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
