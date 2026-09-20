-- CreateTable
CREATE TABLE `wa_numbers` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `phoneNumberId` VARCHAR(191) NOT NULL,
    `wabaId` VARCHAR(191) NOT NULL,
    `displayNumber` VARCHAR(191) NOT NULL,
    `accessTokenEnc` TEXT NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastInboundAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wa_numbers_phoneNumberId_key`(`phoneNumberId`),
    INDEX `wa_numbers_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wa_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `waNumberId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `waId` VARCHAR(191) NOT NULL,
    `windowExpiresAt` DATETIME(3) NULL,
    `lastInboundAt` DATETIME(3) NULL,
    `lastOutboundAt` DATETIME(3) NULL,
    `unread` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `wa_conversations_organizationId_updatedAt_idx`(`organizationId`, `updatedAt`),
    UNIQUE INDEX `wa_conversations_waNumberId_waId_key`(`waNumberId`, `waId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wa_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `direction` ENUM('entrante', 'saliente') NOT NULL,
    `waMessageId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'text',
    `body` TEXT NULL,
    `media` JSON NULL,
    `templateName` VARCHAR(191) NULL,
    `status` ENUM('pendiente', 'enviado', 'entregado', 'leido', 'fallido') NOT NULL DEFAULT 'pendiente',
    `error` TEXT NULL,
    `userId` VARCHAR(191) NULL,
    `raw` JSON NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `wa_messages_waMessageId_key`(`waMessageId`),
    INDEX `wa_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `wa_numbers` ADD CONSTRAINT `wa_numbers_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_numbers` ADD CONSTRAINT `wa_numbers_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_waNumberId_fkey` FOREIGN KEY (`waNumberId`) REFERENCES `wa_numbers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_conversations` ADD CONSTRAINT `wa_conversations_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_messages` ADD CONSTRAINT `wa_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `wa_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wa_messages` ADD CONSTRAINT `wa_messages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
