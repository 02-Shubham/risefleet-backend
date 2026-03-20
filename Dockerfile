# Use Node.js 22 LTS (Lightweight Alpine version)
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies (including Prisma)
COPY package*.json ./
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build TypeScript
COPY . .
RUN npm run build

# --- Production Image ---
FROM node:22-alpine

WORKDIR /app

# Copy production dependencies and built files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Environment variables (Railway will provide these)
ENV PORT=8080
ENV TCP_PORT=5001
ENV NODE_ENV=production

# Expose ports
EXPOSE 8080
EXPOSE 5001

# Start the application
CMD ["node", "dist/index.js"]
