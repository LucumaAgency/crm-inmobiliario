-- AlterTable
ALTER TABLE `projects` ADD COLUMN `district` VARCHAR(191) NULL,
    ADD COLUMN `legalName` VARCHAR(191) NULL,
    ADD COLUMN `logoUrl` VARCHAR(191) NULL,
    ADD COLUMN `ruc` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `units` ADD COLUMN `bathrooms` INTEGER NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `proformas` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `year` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `client` JSON NOT NULL,
    `agent` JSON NOT NULL,
    `items` JSON NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PEN',
    `listTotal` DECIMAL(14, 2) NOT NULL,
    `discountPct` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `finalTotal` DECIMAL(14, 2) NOT NULL,
    `validDays` INTEGER NOT NULL DEFAULT 3,
    `validUntil` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `pdfPath` VARCHAR(191) NOT NULL,
    `emailSentAt` DATETIME(3) NULL,
    `emailTo` VARCHAR(191) NULL,
    `whatsappSentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `proformas_leadId_createdAt_idx`(`leadId`, `createdAt`),
    UNIQUE INDEX `proformas_organizationId_year_seq_key`(`organizationId`, `year`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proformas` ADD CONSTRAINT `proformas_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
