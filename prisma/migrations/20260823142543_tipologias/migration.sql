-- AlterTable
ALTER TABLE `units` ADD COLUMN `typologyId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `typologies` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `bedrooms` INTEGER NULL,
    `bathrooms` INTEGER NULL,
    `areaM2` DECIMAL(10, 2) NULL,
    `priceFrom` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PEN',
    `description` TEXT NULL,
    `planUrl` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `typologies_projectId_active_idx`(`projectId`, `active`),
    UNIQUE INDEX `typologies_projectId_name_key`(`projectId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `units_typologyId_idx` ON `units`(`typologyId`);

-- AddForeignKey
ALTER TABLE `typologies` ADD CONSTRAINT `typologies_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `units` ADD CONSTRAINT `units_typologyId_fkey` FOREIGN KEY (`typologyId`) REFERENCES `typologies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
