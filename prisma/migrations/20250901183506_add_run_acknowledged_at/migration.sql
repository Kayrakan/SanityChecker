/*
  Warnings:

  - You are about to drop the column `address1` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `address2` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `company` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `firstName` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `Scenario` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Scenario` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Run" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."Scenario" DROP COLUMN "address1",
DROP COLUMN "address2",
DROP COLUMN "company",
DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "phone";
