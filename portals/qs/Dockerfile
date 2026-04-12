FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json  ./packages/shared/
COPY packages/shared/prisma        ./packages/shared/prisma/
COPY packages/shared/index.js      ./packages/shared/
COPY packages/shared/middleware    ./packages/shared/middleware/
COPY packages/shared/services      ./packages/shared/services/
COPY packages/shared/routes        ./packages/shared/routes/
COPY packages/shared/components    ./packages/shared/components/
COPY portals/qs/package.json       ./portals/qs/

RUN npm install --omit=dev
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

COPY portals/qs/backend ./portals/qs/backend/

ENV NODE_ENV=production PORT=3005
EXPOSE 3005
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "portals/qs/backend/index.js"]
