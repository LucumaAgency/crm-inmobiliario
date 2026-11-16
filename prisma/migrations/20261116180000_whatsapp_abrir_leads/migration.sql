-- Interruptor por número: abrir o no leads con los chats nuevos (coexistencia del número general).
ALTER TABLE `wa_numbers` ADD COLUMN `abrirLeads` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `wa_altas` ADD COLUMN `abrirLeads` BOOLEAN NOT NULL DEFAULT true;
