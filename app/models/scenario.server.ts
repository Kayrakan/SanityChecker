import prisma from "../db.server";

export type UpsertScenarioInput = {
  id?: string;
  shopId: string;
  name: string;
  active?: boolean;
  countryCode: string;
  postalCode?: string;
  provinceCode?: string;
  productVariantIds: string[];
  quantities: number[];
  discountCode?: string | null;
  expectations?: any;
};

export async function listScenarios(shopId: string) {
  return prisma.scenario.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getScenario(id: string) {
  return prisma.scenario.findUnique({ where: { id } });
}

export async function upsertScenario(input: UpsertScenarioInput) {
  const { id, ...data } = input;
  if (id) {
    return prisma.scenario.update({ where: { id }, data });
  }
  return prisma.scenario.create({ data });
}

export async function deleteScenario(id: string, shopId: string) {
  return prisma.scenario.delete({ where: { id } });
}


