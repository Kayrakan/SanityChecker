import prisma from "../db.server.js";
export async function ensureShop(domain) {
    const existing = await prisma.shop.findUnique({ where: { domain } });
    if (existing)
        return existing;
    const created = await prisma.shop.create({
        data: {
            domain,
            settings: {
                create: {},
            },
        },
        include: { settings: true },
    });
    return created;
}
export async function getShopByDomain(domain) {
    return prisma.shop.findUnique({ where: { domain }, include: { settings: true } });
}
