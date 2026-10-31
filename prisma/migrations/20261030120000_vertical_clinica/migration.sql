-- Vertical clínica (docs/29-VERTICAL-CLINICA.md): sede derivada, procedimiento realizado y
-- fecha de cierre. wonAt se rellena para los leads ya ganados con su última actualización
-- (aproximación: no hay otra fecha guardada del cierre).
ALTER TABLE `leads`
  ADD COLUMN `referredTo` VARCHAR(191) NULL,
  ADD COLUMN `procedureId` VARCHAR(191) NULL,
  ADD COLUMN `wonAt` DATETIME(3) NULL;

CREATE INDEX `leads_organizationId_wonAt_idx` ON `leads`(`organizationId`, `wonAt`);
CREATE INDEX `leads_procedureId_fkey` ON `leads`(`procedureId`);

ALTER TABLE `leads` ADD CONSTRAINT `leads_procedureId_fkey`
  FOREIGN KEY (`procedureId`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `leads` SET `wonAt` = `updatedAt` WHERE `status` = 'ganado' AND `wonAt` IS NULL;
