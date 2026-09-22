-- AlterTable
ALTER TABLE `users` ADD COLUMN `passwordChangedAt` DATETIME(3) NULL,
    ADD COLUMN `passwordHash` VARCHAR(191) NULL;
