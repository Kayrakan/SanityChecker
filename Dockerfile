FROM node:18-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ARG SHOPIFY_APP_URL
ARG SHOPIFY_API_KEY
ARG SHOPIFY_API_SECRET
ARG DATABASE_URL


ENV SHOPIFY_APP_URL=$SHOPIFY_APP_URL \
    SHOPIFY_API_KEY=$SHOPIFY_API_KEY \
    SHOPIFY_API_SECRET=$SHOPIFY_API_SECRET \
    DATABASE_URL=$DATABASE_URL
    
ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force
# Remove CLI packages since we don't need them in production by default.
# Remove this line if you want to run CLI commands in your container.
COPY prisma ./prisma
RUN npx prisma generate

RUN npm remove @shopify/cli

COPY . .

RUN npm run build

CMD ["npm", "run", "docker-start"]
