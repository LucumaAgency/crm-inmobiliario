-- Moneda por organización (PEN por defecto; USD para Heavy Listing).
ALTER TABLE `organizations` ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'PEN';
