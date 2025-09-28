import prisma from "../db.server";
export async function listScenarios(shopId) {
    return prisma.scenario.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
    });
}
export async function getScenario(id) {
    return prisma.scenario.findUnique({ where: { id } });
}
export async function upsertScenario(input) {
    const { id, ...data } = input;
    if (id) {
        return prisma.scenario.update({ where: { id }, data });
    }
    return prisma.scenario.create({ data });
}
export async function deleteScenario(id, shopId) {
    return prisma.scenario.delete({ where: { id } });
}
