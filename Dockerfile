FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci 
# Remove CLI packages since we don't need them in production by default.
# Remove this line if you want to run CLI commands in your container.
COPY prisma ./prisma
RUN npx prisma generate

RUN npm remove @shopify/cli

COPY . .

RUN PRISMA_SKIP_CONNECT_ON_BOOT=1 npm run build

RUN npm prune --omit=dev && npm cache clean --force

CMD ["npm", "run", "docker-start"]
