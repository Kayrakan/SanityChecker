FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

RUN npm remove @shopify/cli || true

COPY . .

RUN npm run build

RUN npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
