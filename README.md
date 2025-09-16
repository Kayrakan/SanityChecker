# Shipping Sanity Tester (Shopify App) – Comprehensive README

> Nightly (and on-demand) synthetic carts to the shipping step that catch broken/missing/wrong shipping rates, provide actionable fix links, and send a morning green-check or alerts. Phase 2 adds a live watcher for real shopper drop-offs.

## Why this matters

Silent failures like “No shipping rates available”, wrong prices, or free-shipping not triggering cause revenue loss without obvious error signals. These issues emerge after theme/app updates, new products, market/zone edits, carrier hiccups, or discount changes. Merchants often discover them hours or days later via complaints or conversion dips.

## What this app does

- Scenario builder: define where/how to test (countries, postcodes, cart composition, discount codes, expectations).
- Synthetic run: creates a cart via Storefront API, sets buyer country/address, and reads shipping delivery options (rates).
- Matcher & diagnostics: checks presence, thresholds (e.g., free over €50), and price bounds; offers likely causes with deep links.
- Digest & alerts: daily Slack/email with green-check or concise failures + Fix/Re-run links. On-demand runs anytime.
- Data minimalism: stops at shipping step; no real orders; no PII.

## MVP scope (v1)

- Scenarios: destination (country + postcode), 1–2 products (light/heavy/oversized), optional discount code, optional expectations (free threshold, min/max bounds).
- Runner: Storefront GraphQL carts + delivery options; Admin GraphQL for diagnostics and Storefront token provisioning.
- Matcher: presence (any rates?), thresholds (free shipping expected?), price range sanity.
- Diagnostics: probable causes with deep links (Zones, Markets, Product weights, Functions/Discounts, Profiles).
- Digest & dashboard: daily digests via Slack/email; UI for scenarios, runs, re-run, schedule.

Out of scope v1: payment gateways, complex personalization, multi-origin (optional v1.1), live watcher (Phase 2).

## How it works

1) Scenario builder
   - Destination: country (e.g., US/UK/DE) + postcode (e.g., 94107).
   - Cart: choose representative products for light/heavy/oversized.
   - Discount: optional code to validate free-shipping triggers.
   - Expectations: optional (e.g., EU free ≥ €50, US ground $5–$15).

2) Runner (nightly / on-demand)
   - Uses Storefront API to create a cart, sets buyer country/address, and requests `cart.deliveryGroups.deliveryOptions`.
   - Stores raw rate list and derived diagnostics.
   - Automatically provisions a Storefront access token via Admin GraphQL mutation `storefrontAccessTokenCreate` when needed (no manual merchant input).

3) Matcher
   - No rates: flag likely causes (missing zone, weight 0/not-physical, market inactive, mixed-profile incompatibility, provider outage).
   - Free-shipping expected but missing: threshold mismatch/currency edge.
   - Price out-of-bounds: warn on too high/low.

4) Diagnostics
   - Shows tested address/cart/discount, expectations, observed rates.
   - Probable causes (ranked) and deep links into Admin: Profiles → Zone, Markets → Country, Product → Shipping, Discounts/Functions, etc.

5) Digest & alerts
   - Morning digest: green-check when all pass; else concise failures with Fix and Re-run.
   - Promo mode: optional hourly runs.

## Screens (MVP)

- Scenarios: list with destination and status, New/Run actions.
- Scenario detail: name, destination, active toggle, items editor, expectations.
- Runs: list and detail with raw rates JSON, diagnostics, re-run.
- Settings: schedule, Slack & email, promo mode. Storefront token is auto-provisioned—no manual input required.

## Data model (Prisma / Postgres)

- Session: Shopify app sessions (via Prisma adapter).
- Shop: `{ id, domain, name?, createdAt, updatedAt }`.
- Settings: `{ shopId (1:1), dailyRunHourUtc, promoMode, slackWebhookUrl?, notificationEmail?, storefrontAccessToken?, storefrontApiVersion? }`.
- Scenario: `{ id, shopId, name, active, countryCode, postalCode?, provinceCode?, productVariantIds[], quantities[], discountCode?, expectations?, nextRunAt?, createdAt, updatedAt }`.
- Run: `{ id, scenarioId, shopId, status (PENDING|PASS|WARN|FAIL|ERROR|BLOCKED), startedAt, finishedAt?, result?, diagnostics?, notes?, screenshotUrl? }`.
- Job: `{ id, type (SCENARIO_RUN|DIGEST_EMAIL), status (QUEUED|PROCESSING|SUCCEEDED|FAILED), shopId?, scenarioId?, runId?, attempts, lastError?, scheduledAt, availableAt, payload? }`.

## Architecture

- Frontend: Remix + Polaris + App Bridge (embedded app, TypeScript).
- Backend: Remix server; Admin GraphQL; Storefront GraphQL.
- Auth/session: `@shopify/shopify-app-remix` with Prisma session storage.
- DB: Neon Postgres (via Prisma). Single DB for sessions + app data.
- Jobs: Postgres-backed job table + internal drain endpoint.
- Notifications: Slack incoming webhook; Email via Resend (or SendGrid/Mailgun).
- Observability: Console logs; Sentry recommended (not included by default).

## Storefront token provisioning (automatic)

- After OAuth, we have an Admin access token (offline session). When a run needs Storefront access, we call:

  - Admin GraphQL mutation `storefrontAccessTokenCreate(input: { title })`.
  - Persist `accessToken` in `Settings.storefrontAccessToken` and default `storefrontApiVersion` (e.g., `2025-01`).
  - Use that token for Storefront GraphQL requests (carts, delivery options).
  - Shopify limit: up to 100 active Storefront tokens per app per shop.

No merchant token copy/paste required.

## Routes

App UI
- `/app` – Dashboard (overview, pass rate, recent runs, quick actions)
- `/app/scenarios` – Scenarios list (new/run)
- `/app/scenarios/:id` – Scenario detail (destination, active)
- `/app/scenarios/:id/items` – Items editor (variant GIDs, quantities)
- `/app/runs` – Runs list
- `/app/runs/:id` – Run detail
- `/app/settings` – Scheduling, notifications, promo mode (Storefront token auto-handled)

Internal (secured by `CRON_SECRET` query param)
- `/internal/cron?key=…` – Enqueue runs based on schedule (daily/hourly).
- `/internal/queue/drain?key=…` – Process queued jobs (scenario runs, digests).
- `/internal/digest?key=…` – Send daily digests across shops.

## Environment & setup

Required
```
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://<your-ngrok-or-host>
SCOPES=read_products,write_products
DATABASE_URL=postgresql://USER:PASS@HOST/DB?sslmode=require
CRON_SECRET=<random-hex>
```

Optional (email digests via Resend)
```
RESEND_API_KEY=...
RESEND_FROM="Sanity Tester <noreply@yourdomain.com>"
```

Install & dev
```
npm install
npx prisma generate
npx prisma migrate dev --name init_app
shopify app dev
```

Cron / queue (local testing)
```
curl "http://localhost:PORT/internal/cron?key=$CRON_SECRET"
curl "http://localhost:PORT/internal/queue/drain?key=$CRON_SECRET"
curl "http://localhost:PORT/internal/digest?key=$CRON_SECRET"
```

## BullMQ worker (high‑throughput queue)

We use Redis + BullMQ for production‑grade job processing.

Env vars (examples):
```
# Redis
REDIS_URL=redis://:password@host:6379
# or
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=...
REDIS_TLS=0

# Worker tuning
WORKER_CONCURRENCY=10
SHOP_LOCK_TTL_MS=60000
```

Install & run worker locally:
```
npm install
npm run worker
```

What it does:
- Enqueue: UI calls Bull producer which creates a `Run` row, then adds a `SCENARIO_RUN` job with `{ shopId, scenarioId, runId }`.
- Process: Worker claims jobs with per‑shop lock, calls `runScenarioById(scenarioId, runId)`, writes results back to the `Run` row.
- Retry/backoff: exponential retry for transient failures; per‑shop serialization via Redis lock.

## Permissions & scopes

- Admin GraphQL (app scopes via Shopify CLI / app config):
  - Read products (weights), markets, shipping profiles, discounts (as needed).
  - Used also to create Storefront access tokens programmatically.
- Storefront GraphQL: requires store-scoped token (auto-provisioned) to access carts + delivery options.

## Diagnostics (examples)

- No rates:
  - Missing zone in shipping profile; product weight 0 or not-physical; market inactive; address format/province issues; mixed-profile incompatibility; provider outage.
- Free shipping missing:
  - Threshold/currency mismatch; discount edge (49.90 vs ≥50.00) – test just above the line.
- Outlier prices:
  - Too high/low rates → investigate carrier, functions, or misconfigured bands.

Deep links point to: Profiles/Zones, Product → Shipping, Markets → Countries, Discounts/Functions.

## Scheduling & jobs

- Settings configure daily run hour UTC and promo mode (hourly).
- `/internal/cron` reads settings and enqueues active scenarios per shop.
- `/internal/queue/drain` processes jobs with a safety cap.
- Job types: `SCENARIO_RUN`, `DIGEST_EMAIL`.

## Notifications

- Slack: simple POST to incoming webhook.
- Email: Resend REST API (subject + plaintext summary). Replace or extend with SendGrid/Mailgun to preference.

## Security & privacy

- No customer PII; test addresses only. No real orders.
- Storefront tokens stored in DB; Admin offline sessions stored via Prisma session storage.
- Internal endpoints secured by `CRON_SECRET` (use long random values; rotate as needed).
- Consider adding Sentry, rate-limiting, and per-shop execution budgets.

## Pricing (proposed)

- $29/mo – up to 10 scenarios (nightly)
- $59/mo – up to 30 scenarios (nightly + promo hourly)
- $99/mo – up to 60 scenarios (priority support)

Value promise: preventing even one “no rates” day can pay for itself.

## Success metrics (pilot)

- ≥1 real issue caught per week before customers complain.
- 80% of failures are self-fixable with provided links.
- Median open→fix < 24h; churn after month 1 < 20%.

## Roadmap

- v1.1: screenshots (headless), boundary sweeps near thresholds, weekly SKU rotation per profile, mixed-cart scenario, coverage chart.
- Phase 2: live watcher for real shoppers (anonymous), anomaly alerts for regional spikes, aggregated metrics only.

## Troubleshooting

- Prisma DATABASE_URL missing → ensure `.env` includes a valid Postgres URL (Neon recommended).
- Shopify embedded navigation → always use `<Link/>` or Remix navigation APIs; avoid raw anchors.
- Storefront token errors → the app auto-creates tokens; if near the 100-token limit per shop, consider reusing existing tokens.
- Admin rate limits → batch requests, apply backoff; queue jobs per shop.
- Neon connection limits → prefer HTTP pooling and conservative concurrency.

---
# Shopify App Template - Remix

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using the [Remix](https://remix.run) framework.

Rather than cloning this repo, you can use your preferred package manager and the Shopify CLI with [these steps](https://shopify.dev/docs/apps/getting-started/create).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-remix) for more details on the Remix app package.

## Quick start

### Prerequisites

Before you begin, you'll need the following:

1. **Node.js**: [Download and install](https://nodejs.org/en/download/) it if you haven't already.
2. **Shopify Partner Account**: [Create an account](https://partners.shopify.com/signup) if you don't have one.
3. **Test Store**: Set up either a [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or a [Shopify Plus sandbox store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store) for testing your app.

### Setup

If you used the CLI to create the template, you can skip this section.

Using yarn:

```shell
yarn install
```

Using npm:

```shell
npm install
```

Using pnpm:

```shell
pnpm install
```

### Local Development

Using yarn:

```shell
yarn dev
```

Using npm:

```shell
npm run dev
```

Using pnpm:

```shell
pnpm run dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your partners account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes preconfigured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks in individual files such as [/app/routes/webhooks.app.uninstalled.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/webhooks.app.uninstalled.tsx) and [/app/routes/webhooks.app.scopes_update.tsx](https://github.com/Shopify/shopify-app-template-remix/blob/main/app/routes/webhooks.app.scopes_update.tsx)

Please read the [documentation for @shopify/shopify-app-remix](https://www.npmjs.com/package/@shopify/shopify-app-remix#authenticating-admin-requests) to understand what other API's are available.

## Shipping Sanity Tester MVP notes

Environment variables:

```
DATABASE_URL=postgresql://<user>:<pass>@<host>/<db>?sslmode=require
CRON_SECRET=<random>
```

Endpoints:

- `/internal/cron?key=$CRON_SECRET` – schedules active scenarios for each shop
- `/internal/queue/drain?key=$CRON_SECRET` – processes queued jobs (scenario runs, digest email)

Per-shop settings require a Storefront access token to run scenarios. Configure in `App → Settings`.

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
You can run your database of choice on a server yourself or host it with a SaaS company.
Here's a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Remix handles building the app for you, by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/deployment/web) to host your app on a cloud provider like [Heroku](https://www.heroku.com/) or [Fly.io](https://fly.io/).

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

### Hosting on Vercel

Using the Vercel Preset is recommended when hosting your Shopify Remix app on Vercel. You'll also want to ensure imports that would normally come from `@remix-run/node` are imported from `@vercel/remix` instead. Learn more about hosting Remix apps on Vercel [here](https://vercel.com/docs/frameworks/remix).

```diff
// vite.config.ts
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
+ import { vercelPreset } from '@vercel/remix/vite';

installGlobals();

export default defineConfig({
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
+     presets: [vercelPreset()],
    }),
    tsconfigPaths(),
  ],
});
```

## Troubleshooting

### Database tables don't exist

If you get this error:

```
The table `main.Session` does not exist in the current database.
```

You need to create the database for Prisma. Run the `setup` script in `package.json` using your preferred package manager.

### Navigating/redirecting breaks an embedded app

Embedded Shopify apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `@remix-run/react` or `@shopify/polaris`. Do not use `<a>`.
2. Use the `redirect` helper returned from `authenticate.admin`. Do not use `redirect` from `@remix-run/node`
3. Use `useSubmit` or `<Form/>` from `@remix-run/react`. Do not use a lowercase `<form/>`.

This only applies if your app is embedded, which it will be by default.

### Non Embedded

Shopify apps are best when they are embedded in the Shopify Admin, which is how this template is configured. If you have a reason to not embed your app please make the following changes:

1. Ensure `embedded = false` is set in [shopify.app.toml`](./shopify.app.toml). [Docs here](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration#global).
2. Pass `isEmbeddedApp: false` to `shopifyApp()` in `./app/shopify.server.js|ts`.
3. Change the `isEmbeddedApp` prop to `isEmbeddedApp={false}` for the `AppProvider` in `/app/routes/app.jsx|tsx`.
4. Remove the `@shopify/app-bridge-react` dependency from [package.json](./package.json) and `vite.config.ts|js`.
5. Remove anything imported from `@shopify/app-bridge-react`.  For example: `NavMenu`, `TitleBar` and `useAppBridge`.

### OAuth goes into a loop when I change my app's scopes

If you change your app's scopes and authentication goes into a loop and fails with a message from Shopify that it tried too many times, you might have forgotten to update your scopes with Shopify.
To do that, you can run the `deploy` CLI command.

Using yarn:

```shell
yarn deploy
```

Using npm:

```shell
npm run deploy
```

Using pnpm:

```shell
pnpm run deploy
```

### My shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.  

Instead of using the `afterAuth` hook, the recommended approach is to declare app-specific webhooks in the `shopify.app.toml` file.  This approach is easier since Shopify will automatically update changes to webhook subscriptions every time you run `deploy` (e.g: `npm run deploy`).  Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?framework=remix&deliveryMethod=https)

If you do need shop-specific webhooks, please keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, you can uninstall and reinstall it in your development store. That will force the OAuth process and call the `afterAuth` hook.

### Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.  There are 2 solutions:

1. Use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead (recommended)
2. Create [webhook subscriptions](https://shopify.dev/docs/api/shopify-app-remix/v1/guide-webhooks) using the `shopifyApp` object.

Test your webhooks with the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger) or by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for VS Code will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

in this situation, please update the [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-remix/blob/main/.graphqlrc.ts) config.

### First parameter has member 'readable' that is not a ReadableStream.

See [hosting on Vercel](#hosting-on-vercel).

### Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Using Defer & await for streaming responses

To test [streaming using defer/await](https://remix.run/docs/en/main/guides/streaming) during local development you'll need to use the Shopify CLI slightly differently:

1. First setup ngrok: https://ngrok.com/product/secure-tunnels
2. Create an ngrok tunnel on port 8080: `ngrok http 8080`.
3. Copy the forwarding address. This should be something like: `https://f355-2607-fea8-bb5c-8700-7972-d2b5-3f2b-94ab.ngrok-free.app`
4. In a separate terminal run `yarn shopify app dev --tunnel-url=TUNNEL_URL:8080` replacing `TUNNEL_URL` for the address you copied in step 3.

By default the CLI uses a cloudflare tunnel. Unfortunately it cloudflare tunnels wait for the Response stream to finish, then sends one chunk.

This will not affect production, since tunnels are only for local development.

### Using MongoDB and Prisma

By default this template uses SQLlite as the database. It is recommended to move to a persisted database for production. If you choose to use MongoDB, you will need to make some modifications to the schema and prisma configuration. For more information please see the [Prisma MongoDB documentation](https://www.prisma.io/docs/orm/overview/databases/mongodb).

Alternatively you can use a MongDB database directly with the [MongoDB session storage adapter](https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/session-storage/shopify-app-session-storage-mongodb).

#### Mapping the id field

In MongoDB, an ID must be a single field that defines an @id attribute and a @map("\_id") attribute.
The prisma adapter expects the ID field to be the ID of the session, and not the \_id field of the document.

To make this work you can add a new field to the schema that maps the \_id field to the id field. For more information see the [Prisma documentation](https://www.prisma.io/docs/orm/prisma-schema/data-model/models#defining-an-id-field)

```prisma
model Session {
  session_id  String    @id @default(auto()) @map("_id") @db.ObjectId
  id          String    @unique
...
}
```

#### Error: The "mongodb" provider is not supported with this command

MongoDB does not support the [prisma migrate](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/overview) command. Instead, you can use the [prisma db push](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#db-push) command and update the `shopify.web.toml` file with the following commands. If you are using MongoDB please see the [Prisma documentation](https://www.prisma.io/docs/orm/overview/databases/mongodb) for more information.

```toml
[commands]
predev = "npx prisma generate && npx prisma migrate deploy"
dev = "npm exec remix vite:dev"
```

#### Prisma needs to perform transactions, which requires your mongodb server to be run as a replica set

See the [Prisma documentation](https://www.prisma.io/docs/getting-started/setup-prisma/start-from-scratch/mongodb/connect-your-database-node-mongodb) for connecting to a MongoDB database.

### I want to use Polaris v13.0.0 or higher

Currently, this template is set up to work on node v18.20 or higher. However, `@shopify/polaris` is limited to v12 because v13 can only run on node v20+.

You don't have to make any changes to the code in order to be able to upgrade Polaris to v13, but you'll need to do the following:

- Upgrade your node version to v20.10 or higher.
- Update your `Dockerfile` to pull `FROM node:20-alpine` instead of `node:18-alpine`

### "nbf" claim timestamp check failed

This error will occur of the `nbf` claim timestamp check failed. This is because the JWT token is expired.
If you  are consistently getting this error, it could be that the clock on your machine is not in sync with the server.

To fix this ensure you have enabled `Set time and date automatically` in the `Date and Time` settings on your computer.

## Benefits

Shopify apps are built on a variety of Shopify tools to create a great merchant experience.

<!-- TODO: Uncomment this after we've updated the docs -->
<!-- The [create an app](https://shopify.dev/docs/apps/getting-started/create) tutorial in our developer documentation will guide you through creating a Shopify app using this template. -->

The Remix app template comes with the following out-of-the-box functionality:

- [OAuth](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-admin-requests): Installing the app and granting permissions
- [GraphQL Admin API](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#using-the-shopify-admin-graphql-api): Querying or mutating Shopify admin data
- [Webhooks](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-webhook-requests): Callbacks sent by Shopify when certain events occur
- [AppBridge](https://shopify.dev/docs/api/app-bridge): This template uses the next generation of the Shopify App Bridge library which works in unison with previous versions.
- [Polaris](https://polaris.shopify.com/): Design system that enables apps to create Shopify-like experiences

## Tech Stack

This template uses [Remix](https://remix.run). The following Shopify tools are also included to ease app development:

- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix) provides authentication and methods for interacting with Shopify APIs.
- [Shopify App Bridge](https://shopify.dev/docs/apps/tools/app-bridge) allows your app to seamlessly integrate your app within Shopify's Admin.
- [Polaris React](https://polaris.shopify.com/) is a powerful design system and component library that helps developers build high quality, consistent experiences for Shopify merchants.
- [Webhooks](https://github.com/Shopify/shopify-app-js/tree/main/packages/shopify-app-remix#authenticating-webhook-requests): Callbacks sent by Shopify when certain events occur
- [Polaris](https://polaris.shopify.com/): Design system that enables apps to create Shopify-like experiences

## Resources

- [Remix Docs](https://remix.run/docs/en/v1)
- [Shopify App Remix](https://shopify.dev/docs/api/shopify-app-remix)
- [Introduction to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [App authentication](https://shopify.dev/docs/apps/auth)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)
- [Getting started with internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
