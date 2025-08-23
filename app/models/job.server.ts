import prisma from "../db.server";

export async function enqueueScenarioRun(shopId: string, scenarioId: string, availableAt?: Date) {
  return prisma.job.create({
    data: {
      type: "SCENARIO_RUN" as any,
      status: "QUEUED" as any,
      shopId,
      scenarioId,
      availableAt: availableAt ?? new Date(),
    },
  });
}

export async function enqueueDigestEmail(shopId: string, scheduledAt?: Date) {
  return prisma.job.create({
    data: {
      type: "DIGEST_EMAIL" as any,
      status: "QUEUED" as any,
      shopId,
      availableAt: scheduledAt ?? new Date(),
    },
  });
}

export async function claimNextJob(now = new Date()) {
  // naive claim: find first queued and set to processing
  const job = await prisma.job.findFirst({
    where: { status: "QUEUED" as any, availableAt: { lte: now } },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;
  return prisma.job.update({ where: { id: job.id }, data: { status: "PROCESSING" as any, attempts: { increment: 1 } } });
}

export async function finishJob(id: string, ok: boolean, error?: string) {
  return prisma.job.update({
    where: { id },
    data: {
      status: (ok ? "SUCCEEDED" : "FAILED") as any,
      lastError: error,
    },
  });
}


