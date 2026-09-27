-- CreateTable
CREATE TABLE `notas_voz` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `audioPath` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(191) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `durationSec` INTEGER NULL,
    `status` ENUM('pendiente', 'transcrita', 'lista', 'error') NOT NULL DEFAULT 'pendiente',
    `transcript` TEXT NULL,
    `propuesta` JSON NULL,
    `error` TEXT NULL,
    `activityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notas_voz_leadId_createdAt_idx`(`leadId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notas_voz` ADD CONSTRAINT `notas_voz_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notas_voz` ADD CONSTRAINT `notas_voz_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notas_voz` ADD CONSTRAINT `notas_voz_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
