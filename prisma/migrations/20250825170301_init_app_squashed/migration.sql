-- CreateEnum
CREATE TYPE "public"."AlertLevel" AS ENUM ('WARN', 'FAIL');

-- CreateEnum
CREATE TYPE "public"."RunStatus" AS ENUM ('PENDING', 'PASS', 'WARN', 'FAIL', 'ERROR', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."JobType" AS ENUM ('SCENARIO_RUN', 'DIGEST_EMAIL');

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Settings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dailyRunHourUtc" INTEGER NOT NULL DEFAULT 7,
    "promoMode" BOOLEAN NOT NULL DEFAULT false,
    "slackWebhookUrl" TEXT,
    "notificationEmail" TEXT,
    "storefrontAccessToken" TEXT,
    "storefrontApiVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Scenario" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "countryCode" TEXT NOT NULL,
    "postalCode" TEXT,
    "provinceCode" TEXT,
    "city" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "phone" TEXT,
    "productVariantIds" TEXT[],
    "quantities" INTEGER[],
    "discountCode" TEXT,
    "expectations" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "screenshotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "includeInPromo" BOOLEAN NOT NULL DEFAULT false,
    "alertLevel" "public"."AlertLevel" NOT NULL DEFAULT 'WARN',
    "consecutiveFailThreshold" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Run" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "public"."RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "diagnostics" JSONB,
    "notes" TEXT,
    "screenshotUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "type" "public"."JobType" NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'QUEUED',
    "shopId" TEXT,
    "scenarioId" TEXT,
    "runId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "public"."Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shopId_key" ON "public"."Settings"("shopId");

-- CreateIndex
CREATE INDEX "Scenario_shopId_idx" ON "public"."Scenario"("shopId");

-- CreateIndex
CREATE INDEX "Scenario_active_idx" ON "public"."Scenario"("active");

-- CreateIndex
CREATE INDEX "Run_scenarioId_idx" ON "public"."Run"("scenarioId");

-- CreateIndex
CREATE INDEX "Run_shopId_idx" ON "public"."Run"("shopId");

-- CreateIndex
CREATE INDEX "Job_status_availableAt_idx" ON "public"."Job"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Job_scenarioId_idx" ON "public"."Job"("scenarioId");

-- CreateIndex
CREATE INDEX "Job_shopId_idx" ON "public"."Job"("shopId");

-- AddForeignKey
ALTER TABLE "public"."Settings" ADD CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Scenario" ADD CONSTRAINT "Scenario_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Run" ADD CONSTRAINT "Run_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "public"."Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Run" ADD CONSTRAINT "Run_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
