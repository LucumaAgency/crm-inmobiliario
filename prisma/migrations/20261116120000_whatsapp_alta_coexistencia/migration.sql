-- Alta incrustada de WhatsApp (Embedded Signup) y coexistencia. docs/27.

ALTER TABLE `wa_numbers`
    ADD COLUMN `origen` VARCHAR(191) NOT NULL DEFAULT 'manual',
    ADD COLUMN `coexistencia` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ownerUserId` VARCHAR(191) NULL,
    ADD COLUMN `pinEnc` TEXT NULL,
    ADD COLUMN `onboardedAt` DATETIME(3) NULL,
    ADD COLUMN `syncContactosAt` DATETIME(3) NULL,
    ADD COLUMN `syncHistorialAt` DATETIME(3) NULL,
    ADD COLUMN `syncRequestIds` JSON NULL,
    ADD COLUMN `syncError` TEXT NULL,
    ADD COLUMN `historialEstado` VARCHAR(191) NULL,
    ADD COLUMN `historialProgreso` INTEGER NULL;

ALTER TABLE `wa_numbers` ADD CONSTRAINT `wa_numbers_ownerUserId_fkey`
    FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `wa_messages` ADD COLUMN `via` VARCHAR(191) NULL;

CREATE TABLE `wa_altas` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `modo` VARCHAR(191) NOT NULL,
    `ownerUserId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `volverA` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `resultado` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wa_altas_tokenHash_key`(`tokenHash`),
    INDEX `wa_altas_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `wa_altas` ADD CONSTRAINT `wa_altas_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
