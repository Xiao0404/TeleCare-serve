FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN set -eux; \
  apt-get update \
  -o Acquire::Retries=3 \
  -o Acquire::ForceIPv4=true \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG DATABASE_URL=mysql://root:placeholder@localhost:3306/care_db
ENV DATABASE_URL=${DATABASE_URL}

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

RUN set -eux; \
  apt-get update \
  -o Acquire::Retries=3 \
  -o Acquire::ForceIPv4=true \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist

EXPOSE 3500

CMD ["node", "dist/src/main.js"]
