-- Perfis e permissoes configuraveis por empresa; preserva todos os usuarios e memberships.
CREATE TABLE `access_roles` (
 `id` CHAR(36) NOT NULL,
 `org_id` CHAR(36) NOT NULL,
 `slug` VARCHAR(32) NOT NULL,
 `name` VARCHAR(80) NOT NULL,
 `description` VARCHAR(300) NULL,
 `permissions` JSON NOT NULL,
 `is_system` BOOLEAN NOT NULL DEFAULT false,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`),
 UNIQUE INDEX `uq_access_roles_org_slug` (`org_id`, `slug`),
 INDEX `idx_access_roles_org` (`org_id`),
 CONSTRAINT `access_roles_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `access_roles` (`id`,`org_id`,`slug`,`name`,`description`,`permissions`,`is_system`) SELECT UUID(), `id`, 'master', 'Master', 'Acesso total e administração de cargos.', CAST('["page.dashboard","page.inbox","page.contacts","page.crm","page.chatbots","page.automations","page.campaigns","page.schedules","page.reports","page.technicalOdd","page.technicalReport","page.team","page.settings","page.profile","team.members.manage","team.teams.manage","settings.manage","campaigns.manage","contacts.delete","roles.manage","members.assign_master"]' AS JSON), true FROM `organizations`;
INSERT INTO `access_roles` (`id`,`org_id`,`slug`,`name`,`description`,`permissions`,`is_system`) SELECT UUID(), `id`, 'administrador', 'Administrador', 'Acesso geral e gestão da equipe, sem administrar cargos ou Masters.', CAST('["page.dashboard","page.inbox","page.contacts","page.crm","page.chatbots","page.automations","page.campaigns","page.schedules","page.reports","page.technicalOdd","page.technicalReport","page.team","page.settings","page.profile","team.members.manage","team.teams.manage","settings.manage","campaigns.manage","contacts.delete"]' AS JSON), true FROM `organizations`;
INSERT INTO `access_roles` (`id`,`org_id`,`slug`,`name`,`description`,`permissions`,`is_system`) SELECT UUID(), `id`, 'comercial', 'Comercial', 'Atendimento comercial, equivalente ao antigo Atendente.', CAST('["page.dashboard","page.inbox","page.contacts","page.crm","page.chatbots","page.automations","page.campaigns","page.schedules","page.reports","page.technicalOdd","page.technicalReport","page.profile"]' AS JSON), true FROM `organizations`;
INSERT INTO `access_roles` (`id`,`org_id`,`slug`,`name`,`description`,`permissions`,`is_system`) SELECT UUID(), `id`, 'supervisor', 'Supervisor', 'Somente área técnica e relatórios.', CAST('["page.reports","page.technicalOdd","page.technicalReport"]' AS JSON), true FROM `organizations`;
INSERT INTO `access_roles` (`id`,`org_id`,`slug`,`name`,`description`,`permissions`,`is_system`) SELECT UUID(), `id`, 'tecnico', 'Técnico', 'Somente relatórios técnicos.', CAST('["page.technicalReport"]' AS JSON), true FROM `organizations`;

-- Atualiza papeis legados sem alterar usuario, senha ou associacao de empresa.
UPDATE `org_members` SET `role`='master' WHERE `role`='owner';
UPDATE `org_members` SET `role`='administrador' WHERE `role`='admin';
UPDATE `org_members` SET `role`='comercial' WHERE `role`='agent';
ALTER TABLE `org_members` ALTER COLUMN `role` SET DEFAULT 'comercial';
