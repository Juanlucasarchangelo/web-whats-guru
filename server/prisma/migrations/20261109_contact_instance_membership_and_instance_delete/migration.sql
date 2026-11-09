-- Additive only: preserves all contacts, conversations, messages and integrations.
ALTER TABLE `contacts`
  ADD COLUMN `created_by_user_id` CHAR(36) NULL;
CREATE INDEX `idx_contacts_creator` ON `contacts` (`org_id`, `created_by_user_id`);
CREATE TABLE `contact_integrations` (
  `contact_id` CHAR(36) NOT NULL,
  `integration_id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  PRIMARY KEY (`contact_id`, `integration_id`),
  INDEX `idx_contact_integrations_org_integration` (`org_id`, `integration_id`),
  INDEX `idx_contact_integrations_integration` (`integration_id`),
  CONSTRAINT `fk_contact_integrations_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_contact_integrations_integration` FOREIGN KEY (`integration_id`) REFERENCES `integrations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Reconstruct instance affiliations from existing conversations, without modifying histories.
INSERT IGNORE INTO `contact_integrations` (`contact_id`, `integration_id`, `org_id`)
SELECT DISTINCT c.`contact_id`, c.`integration_id`, c.`org_id`
FROM `conversations` c
INNER JOIN `integrations` i ON i.`id` = c.`integration_id` AND i.`org_id` = c.`org_id`
INNER JOIN `contacts` ct ON ct.`id` = c.`contact_id` AND ct.`org_id` = c.`org_id`
WHERE c.`integration_id` IS NOT NULL;

-- Add new configurable permission only to existing Master/Administrador role records.
UPDATE `access_roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'channels.delete')
WHERE `slug` IN ('master','administrador')
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('channels.delete')) = 0;
