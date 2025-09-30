import prisma from "../db.server.js";
export async function createRun(scenarioId, shopId) {
    return prisma.run.create({
        data: {
            scenarioId,
            shopId,
        },
    });
}
export async function completeRun(id, status, result, diagnostics, notes, screenshotUrl) {
    return prisma.run.update({
        where: { id },
        data: {
            status: status,
            finishedAt: new Date(),
            result: result ?? undefined,
            diagnostics: diagnostics ?? undefined,
            notes,
            screenshotUrl: screenshotUrl ?? undefined,
        },
    });
}
export async function listRunsForScenario(scenarioId, limit = 20) {
    return prisma.run.findMany({
        where: { scenarioId },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}
export async function getRun(id) {
    return prisma.run.findUnique({ where: { id } });
}
// Safety: update lingering PENDING runs that have not updated for a long time
export async function markStuckRunsAsError(shopId, olderThanMs = 30 * 60 * 1000) {
    const threshold = new Date(Date.now() - Math.max(60_000, olderThanMs));
    const stuck = await prisma.run.findMany({ where: { shopId, status: "PENDING", startedAt: { lt: threshold } }, select: { id: true } });
    for (const r of stuck) {
        await prisma.run.update({ where: { id: r.id }, data: { status: "ERROR", diagnostics: [{ code: "RUN_TIMEOUT", message: "Run did not complete in time" }] } });
    }
    return stuck.length;
}
