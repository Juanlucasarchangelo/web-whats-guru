-- A nova página começa bloqueada para todos os cargos exceto Master.
-- Adiciona acesso às organizações já existentes sem modificar outras permissões.
UPDATE `access_roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'page.instagramCrm')
WHERE `slug` = 'master'
  AND JSON_VALID(`permissions`)
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('page.instagramCrm'), '$') = 0;
