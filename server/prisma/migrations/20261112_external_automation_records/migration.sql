-- Additive only. No existing tables or rows are modified or deleted.
CREATE TABLE `external_automation_records` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `automation_id` CHAR(36) NOT NULL,
  `external_id` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `event_date` VARCHAR(10) NULL,
  `payload` JSON NOT NULL,
  `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_external_record_source` (`automation_id`,`external_id`),
  INDEX `idx_external_record_due` (`org_id`,`automation_id`,`event_date`),
  CONSTRAINT `fk_external_record_automation` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_external_record_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
