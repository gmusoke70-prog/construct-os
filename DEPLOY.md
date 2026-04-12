# Construct-OS Deployment Guide

## Architecture

```
[Vercel]  9 React frontends (static, free)
    ↓ API calls
[Railway] API Gateway (port 3000) → 10 Node.js backend services
    ↓
[Railway] PostgreSQL + Redis
```

---

## 1. Database — Supabase (Free PostgreSQL)

1. Go to https://supabase.com → New project
2. Name: `construct-os`  Region: pick closest to Uganda
3. Copy the **Connection String** (with `?pgbouncer=true` for pooling)
4. Paste as `DATABASE_URL` in Railway env vars (step 2)

---

## 2. Backends — Railway

### One-click setup:
1. Go to https://railway.app → New Project → Deploy from GitHub
2. Connect `Rainbow-Musoke/construct-os`
3. Railway auto-detects services from `railway.toml`

### Set these environment variables on **all** services:
```
DATABASE_URL=postgresql://...  (from Supabase)
JWT_SECRET=<64 random hex chars>
ANTHROPIC_API_KEY=sk-ant-...
NODE_ENV=production
```

### Run the database migration (one-time):
In Railway shell on the `migrate` service:
```bash
npx prisma db push --schema=packages/shared/prisma/schema.prisma
node packages/shared/prisma/seed.js
```

### Service URLs after deploy (copy these for Vercel):
- Gateway:  `https://construct-os-gateway.railway.app`
- Auth:     `https://construct-os-auth.railway.app`

---

## 3. Frontends — Vercel (9 deployments)

Each portal frontend is a separate Vercel project.

### Deploy all 9 via Vercel CLI (fastest):
```bash
npm i -g vercel
cd portals/qs/frontend      && vercel --prod && cd ../../..
cd portals/pm/frontend      && vercel --prod && cd ../../..
cd portals/architect/frontend && vercel --prod && cd ../../..
cd portals/structural/frontend && vercel --prod && cd ../../..
cd portals/procurement/frontend && vercel --prod && cd ../../..
cd portals/hr/frontend      && vercel --prod && cd ../../..
cd portals/finance/frontend && vercel --prod && cd ../../..
cd portals/admin/frontend   && vercel --prod && cd ../../..
cd portals/client/frontend  && vercel --prod && cd ../../..
```

### Set this env var on each Vercel project:
```
VITE_API_URL=https://construct-os-gateway.railway.app
```

### Or deploy via Vercel Dashboard (GUI):
1. vercel.com → Add New → Project → Import `Rainbow-Musoke/construct-os`
2. **Root Directory** → set to e.g. `portals/qs/frontend`
3. Framework: Vite  |  Build: `npm run build`  |  Output: `dist`
4. Repeat for each of the 9 portals

---

## 4. Demo Accounts (after seeding)

| Portal | URL | Email | Password |
|--------|-----|-------|----------|
| Admin | construct-os-admin.vercel.app | admin@demo.cos | Demo@1234 |
| Project Manager | construct-os-pm.vercel.app | pm@demo.cos | Demo@1234 |
| Architect | construct-os-architect.vercel.app | arch@demo.cos | Demo@1234 |
| Structural Engineer | construct-os-structural.vercel.app | struct@demo.cos | Demo@1234 |
| Quantity Surveyor | construct-os-qs.vercel.app | qs@demo.cos | Demo@1234 |
| Procurement | construct-os-procurement.vercel.app | proc@demo.cos | Demo@1234 |
| HR Manager | construct-os-hr.vercel.app | hr@demo.cos | Demo@1234 |
| Finance Manager | construct-os-finance.vercel.app | finance@demo.cos | Demo@1234 |
| Client | construct-os-client.vercel.app | client@demo.cos | Demo@1234 |

---

## 5. Alternative: Full Docker on a VPS

If you have a VPS (DigitalOcean, AWS EC2, etc.):

```bash
git clone https://github.com/Rainbow-Musoke/construct-os
cd construct-os
cp .env.example .env
# fill in .env values
docker compose up -d
docker compose exec migrate node packages/shared/prisma/seed.js
```

All 11 services start on a single machine. Access via port 3000.

---

## Environment Variables Reference

| Variable | Where to get |
|----------|-------------|
| `DATABASE_URL` | Supabase → Settings → Database → Connection String |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `REDIS_URL` | Railway → Add Redis plugin |
