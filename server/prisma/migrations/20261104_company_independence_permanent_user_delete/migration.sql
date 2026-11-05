-- Preserva empresas e registros historicos quando um usuario e removido definitivamente.
-- A empresa continua ligada aos seus membros por org_members.
ALTER TABLE `organizations` DROP FOREIGN KEY `fk_organizations_owner`;
ALTER TABLE `organizations` DROP INDEX `idx_organizations_owner_id`;
ALTER TABLE `organizations` DROP COLUMN `owner_id`;
ALTER TABLE `users` ADD COLUMN `requested_org_id` CHAR(36) NULL;
CREATE INDEX `idx_users_requested_org_id` ON `users` (`requested_org_id`);
ALTER TABLE `internal_notes` DROP FOREIGN KEY `fk_notes_author`;
ALTER TABLE `internal_notes` MODIFY COLUMN `author_id` CHAR(36) NULL;
ALTER TABLE `internal_notes` ADD CONSTRAINT `fk_notes_author` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `quick_replies` DROP FOREIGN KEY `fk_quick_replies_creator`;
ALTER TABLE `quick_replies` MODIFY COLUMN `created_by` CHAR(36) NULL;
ALTER TABLE `quick_replies` ADD CONSTRAINT `fk_quick_replies_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `attachments` DROP FOREIGN KEY `fk_attachments_user`;
ALTER TABLE `attachments` MODIFY COLUMN `uploaded_by` CHAR(36) NULL;
ALTER TABLE `attachments` ADD CONSTRAINT `fk_attachments_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `chatbots` DROP FOREIGN KEY `fk_chatbots_creator`;
ALTER TABLE `chatbots` MODIFY COLUMN `created_by` CHAR(36) NULL;
ALTER TABLE `chatbots` ADD CONSTRAINT `fk_chatbots_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `automations` DROP FOREIGN KEY `fk_automations_creator`;
ALTER TABLE `automations` MODIFY COLUMN `created_by` CHAR(36) NULL;
ALTER TABLE `automations` ADD CONSTRAINT `fk_automations_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `campaigns` DROP FOREIGN KEY `fk_campaigns_creator`;
ALTER TABLE `campaigns` MODIFY COLUMN `created_by` CHAR(36) NULL;
ALTER TABLE `campaigns` ADD CONSTRAINT `fk_campaigns_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE `schedules` DROP FOREIGN KEY `fk_schedules_creator`;
ALTER TABLE `schedules` MODIFY COLUMN `created_by` CHAR(36) NULL;
ALTER TABLE `schedules` ADD CONSTRAINT `fk_schedules_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
