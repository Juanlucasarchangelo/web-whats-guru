-- Additive, idempotency ledger. Existing contacts, conversations and automation rules remain untouched.
CREATE TABLE `group_automation_executions` (
  `id` CHAR(36) NOT NULL,
  `org_id` CHAR(36) NOT NULL,
  `automation_id` CHAR(36) NOT NULL,
  `execution_key` VARCHAR(120) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'processing',
  `details` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_group_automation_run` (`automation_id`,`execution_key`),
  INDEX `idx_group_automation_org_created` (`org_id`,`created_at`),
  CONSTRAINT `fk_group_automation_rule` FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_group_automation_org` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
