-- Non-destructive upgrade: new registrations choose one of six regions.
ALTER TABLE `users` ADD COLUMN `requested_org_region` VARCHAR(32) NULL;
ALTER TABLE `organizations` ADD COLUMN `region` VARCHAR(32) NULL;
CREATE INDEX `idx_organizations_region` ON `organizations` (`region`);
