-- AlterTable
ALTER TABLE `leads` ADD COLUMN `interestLevel` INTEGER NULL,
    ADD COLUMN `lostReason` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `maxDiscountPct` DECIMAL(5, 2) NULL;

-- CreateIndex
CREATE INDEX `leads_organizationId_interestLevel_idx` ON `leads`(`organizationId`, `interestLevel`);
