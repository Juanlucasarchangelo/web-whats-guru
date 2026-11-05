-- Seguro para usuarios existentes: todos permanecem aprovados e ativos.
ALTER TABLE `users`
  ADD COLUMN `global_role` VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN `approval_status` VARCHAR(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN `requested_org_name` VARCHAR(150) NULL,
  ADD COLUMN `approved_at` DATETIME(3) NULL,
  ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX `idx_users_approval_status` ON `users`(`approval_status`);

CREATE TABLE `dev_activity` (
  `id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36) NULL,
  `target_user_id` CHAR(36) NULL,
  `action` VARCHAR(100) NOT NULL,
  `details` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_dev_activity_created` (`created_at`),
  INDEX `idx_dev_activity_target` (`target_user_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
