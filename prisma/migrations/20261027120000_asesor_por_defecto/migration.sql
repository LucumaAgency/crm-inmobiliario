-- Asesor por defecto para los leads nuevos (Organization.settings.asesorPorDefecto).
-- Solo datos, sin cambio de esquema. Lucuma → su administrador (dev@lucumaagency.com);
-- Bastión → Alonso (aparraga). Si el usuario no existe, la organización queda como estaba
-- (reparto automático) y se elige en Ajustes → Usuarios.

UPDATE `organizations` o
JOIN `users` u ON u.`organizationId` = o.`id`
  AND u.`active` = 1
  AND LOWER(u.`email`) = 'dev@lucumaagency.com'
SET o.`settings` = JSON_SET(COALESCE(o.`settings`, JSON_OBJECT()), '$.asesorPorDefecto', u.`id`)
WHERE o.`slug` = 'lucuma';

UPDATE `organizations` o
JOIN `users` u ON u.`organizationId` = o.`id`
  AND u.`active` = 1
  AND (LOWER(u.`email`) = 'bastioninmobiliaria@gmail.com' OR LOWER(u.`email`) LIKE 'aparraga@%')
SET o.`settings` = JSON_SET(COALESCE(o.`settings`, JSON_OBJECT()), '$.asesorPorDefecto', u.`id`)
WHERE o.`slug` = 'bastion';
