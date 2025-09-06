import prisma from "../db.server";

export async function createRun(scenarioId: string, shopId: string) {
  return prisma.run.create({
    data: {
      scenarioId,
      shopId,
    },
  });
}

export async function completeRun(id: string, status: string, result?: any, diagnostics?: any, notes?: string, screenshotUrl?: string) {
  return prisma.run.update({
    where: { id },
    data: {
      status: status as any,
      finishedAt: new Date(),
      result: result ?? undefined,
      diagnostics: diagnostics ?? undefined,
      notes,
      screenshotUrl: screenshotUrl ?? undefined,
    },
  });
}

export async function listRunsForScenario(scenarioId: string, limit = 20) {
  return prisma.run.findMany({
    where: { scenarioId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getRun(id: string) {
  return prisma.run.findUnique({ where: { id } });
}


