-- CreateIndex
CREATE INDEX "Run_shopId_createdAt_idx" ON "public"."Run"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_shopId_status_createdAt_idx" ON "public"."Run"("shopId", "status", "createdAt");
