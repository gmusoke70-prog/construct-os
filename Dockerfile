FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything (monorepo needs all package.json files for workspaces)
COPY . .

# Install all workspace dependencies
RUN npm install --legacy-peer-deps

# Generate Prisma client for PostgreSQL
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

EXPOSE 3000

# Push schema to DB, seed demo accounts, then start server
CMD sh -c "npx prisma db push --schema=packages/shared/prisma/schema.prisma --accept-data-loss --force-reset && node packages/shared/prisma/seed.js; node server.js"
