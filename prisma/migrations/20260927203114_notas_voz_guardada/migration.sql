-- AlterTable
ALTER TABLE `notas_voz` MODIFY `status` ENUM('guardada', 'pendiente', 'transcrita', 'lista', 'error') NOT NULL DEFAULT 'pendiente';
