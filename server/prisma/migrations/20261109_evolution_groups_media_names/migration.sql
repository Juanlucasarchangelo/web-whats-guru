-- Aditiva: nenhuma tabela existente ou mensagem é removida.
CREATE TABLE `whatsapp_groups` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `integration_id` CHAR(36) NOT NULL,
  `jid` VARCHAR(120) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `participant_count` INTEGER NULL,
  `contact_id` CHAR(36) NOT NULL,
  `conversation_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_whatsapp_groups_org_instance_jid` (`org_id`, `integration_id`, `jid`),
  UNIQUE INDEX `uq_whatsapp_groups_conversation` (`conversation_id`),
  INDEX `idx_whatsapp_groups_org_instance` (`org_id`, `integration_id`),
  CONSTRAINT `fk_whatsapp_groups_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_whatsapp_groups_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `messages`
  ADD COLUMN `group_sender_jid` VARCHAR(120) NULL,
  ADD COLUMN `group_sender_name` VARCHAR(150) NULL;
ALTER TABLE `conversations` ADD COLUMN `is_group` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `idx_conversations_group` ON `conversations` (`org_id`, `is_group`);
ALTER TABLE `contacts` ADD COLUMN `is_group` BOOLEAN NOT NULL DEFAULT false;
