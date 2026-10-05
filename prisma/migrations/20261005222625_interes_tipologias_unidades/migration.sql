-- CreateTable
CREATE TABLE `lead_typology_interests` (
    `leadId` VARCHAR(191) NOT NULL,
    `typologyId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_typology_interests_typologyId_idx`(`typologyId`),
    PRIMARY KEY (`leadId`, `typologyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lead_unit_interests` (
    `leadId` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_unit_interests_unitId_idx`(`unitId`),
    PRIMARY KEY (`leadId`, `unitId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `lead_typology_interests` ADD CONSTRAINT `lead_typology_interests_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_typology_interests` ADD CONSTRAINT `lead_typology_interests_typologyId_fkey` FOREIGN KEY (`typologyId`) REFERENCES `typologies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_unit_interests` ADD CONSTRAINT `lead_unit_interests_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lead_unit_interests` ADD CONSTRAINT `lead_unit_interests_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
