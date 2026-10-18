-- Servicios sin IGV (clientes que no piden factura)
ALTER TABLE `cliente_servicios` ADD COLUMN `sinIgv` BOOLEAN NOT NULL DEFAULT false;
