FROM node:20-slim

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/prisma/ ./packages/shared/prisma/

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy all source
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

EXPOSE 3000

# Run DB push + seed on first start, then launch server
CMD sh -c "npx prisma db push --schema=packages/shared/prisma/schema.prisma --accept-data-loss && node packages/shared/prisma/seed.js; node server.js"
