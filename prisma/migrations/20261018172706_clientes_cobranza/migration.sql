-- CreateTable
CREATE TABLE `clientes` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `ruc` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `clientes_organizationId_active_idx`(`organizationId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cliente_servicios` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PEN',
    `igvIncluido` BOOLEAN NOT NULL DEFAULT false,
    `periodicidad` VARCHAR(191) NOT NULL DEFAULT 'mensual',
    `diaPago` INTEGER NULL,
    `inicio` DATE NOT NULL,
    `fin` DATE NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'activo',
    `notes` TEXT NULL,
    `cobrarDesde` VARCHAR(191) NOT NULL,
    `avisoRenovacionEl` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cliente_servicios_organizationId_estado_idx`(`organizationId`, `estado`),
    INDEX `cliente_servicios_clienteId_idx`(`clienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cobros` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `servicioId` VARCHAR(191) NULL,
    `periodo` VARCHAR(191) NOT NULL,
    `concepto` VARCHAR(191) NOT NULL,
    `base` DECIMAL(12, 2) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'PEN',
    `vence` DATE NOT NULL,
    `estado` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
    `pagadoEl` DATE NULL,
    `medio` VARCHAR(191) NULL,
    `comprobante` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `avisoVenceEl` DATETIME(3) NULL,
    `avisoVencidoEl` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cobros_organizationId_vence_idx`(`organizationId`, `vence`),
    INDEX `cobros_organizationId_periodo_idx`(`organizationId`, `periodo`),
    INDEX `cobros_clienteId_idx`(`clienteId`),
    UNIQUE INDEX `cobros_servicioId_periodo_key`(`servicioId`, `periodo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clientes` ADD CONSTRAINT `clientes_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cliente_servicios` ADD CONSTRAINT `cliente_servicios_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cliente_servicios` ADD CONSTRAINT `cliente_servicios_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cliente_servicios` ADD CONSTRAINT `cliente_servicios_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cobros` ADD CONSTRAINT `cobros_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cobros` ADD CONSTRAINT `cobros_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `clientes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cobros` ADD CONSTRAINT `cobros_servicioId_fkey` FOREIGN KEY (`servicioId`) REFERENCES `cliente_servicios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
