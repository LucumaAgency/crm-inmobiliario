-- CreateTable
CREATE TABLE `meta_pages` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `pageName` VARCHAR(191) NOT NULL,
    `accessTokenEnc` TEXT NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `formMap` JSON NULL,
    `notifyEmails` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastLeadAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `meta_pages_pageId_key`(`pageId`),
    INDEX `meta_pages_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meta_leads` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `leadgenId` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `metaFormId` VARCHAR(191) NULL,
    `adId` VARCHAR(191) NULL,
    `adsetId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `platform` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `raw` JSON NULL,
    `status` ENUM('recibido', 'procesado', 'fallido', 'descartado') NOT NULL DEFAULT 'recibido',
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `meta_leads_leadgenId_key`(`leadgenId`),
    INDEX `meta_leads_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `meta_leads_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `meta_pages` ADD CONSTRAINT `meta_pages_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meta_pages` ADD CONSTRAINT `meta_pages_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meta_leads` ADD CONSTRAINT `meta_leads_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `meta_leads` ADD CONSTRAINT `meta_leads_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
