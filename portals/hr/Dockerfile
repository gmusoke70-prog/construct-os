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
COPY portals/hr/package.json       ./portals/hr/

RUN npm install --omit=dev
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

COPY portals/hr/backend ./portals/hr/backend/

ENV NODE_ENV=production PORT=3009
EXPOSE 3009
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "portals/hr/backend/index.js"]
