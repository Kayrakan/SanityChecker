import prisma from "../db.server.js";
export async function enqueueScenarioRun(shopId, scenarioId, availableAt) {
    return prisma.job.create({
        data: {
            type: "SCENARIO_RUN",
            status: "QUEUED",
            shopId,
            scenarioId,
            availableAt: availableAt ?? new Date(),
        },
    });
}
export async function enqueueDigestEmail(shopId, scheduledAt) {
    return prisma.job.create({
        data: {
            type: "DIGEST_EMAIL",
            status: "QUEUED",
            shopId,
            availableAt: scheduledAt ?? new Date(),
        },
    });
}
export async function claimNextJob(now = new Date()) {
    // naive claim: find first queued and set to processing
    const job = await prisma.job.findFirst({
        where: { status: "QUEUED", availableAt: { lte: now } },
        orderBy: { createdAt: "asc" },
    });
    if (!job)
        return null;
    return prisma.job.update({ where: { id: job.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
}
export async function finishJob(id, ok, error) {
    return prisma.job.update({
        where: { id },
        data: {
            status: (ok ? "SUCCEEDED" : "FAILED"),
            lastError: error,
        },
    });
}
