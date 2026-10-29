-- Adiciona armazenamento dos formulários ODD e Relatório Técnico; não remove dados existentes.
CREATE TABLE `technical_documents` (
 `id` CHAR(36) NOT NULL,
 `org_id` CHAR(36) NOT NULL,
 `doc_type` VARCHAR(24) NOT NULL,
 `document_number` INTEGER NOT NULL,
 `client_request_id` CHAR(36) NOT NULL,
 `document_date` DATE NOT NULL,
 `client_name` VARCHAR(120) NOT NULL,
 `reference_number` VARCHAR(120) NULL,
 `creator_user_id` CHAR(36) NULL,
 `creator_name` VARCHAR(150) NOT NULL,
 `creator_kind` VARCHAR(24) NOT NULL,
 `payload` LONGTEXT NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`),
 UNIQUE INDEX `uq_technical_documents_sequence` (`org_id`,`doc_type`,`document_number`),
 UNIQUE INDEX `uq_technical_documents_request` (`org_id`,`client_request_id`),
 INDEX `idx_technical_documents_listing` (`org_id`,`doc_type`,`created_at`),
 INDEX `idx_technical_documents_creator` (`creator_user_id`),
 CONSTRAINT `technical_documents_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT `technical_documents_creator_user_id_fkey` FOREIGN KEY (`creator_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `technical_document_counters` (
 `org_id` CHAR(36) NOT NULL,
 `doc_type` VARCHAR(24) NOT NULL,
 `next_number` INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY (`org_id`,`doc_type`),
 CONSTRAINT `technical_document_counters_org_id_fkey` FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Habilitar SOMENTE para Masters atuais. Outros cargos continuam bloqueados
-- até liberação expressa em Equipe & Permissões -> Cargos e permissões.
UPDATE `access_roles`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'page.monitoring')
WHERE `slug` = 'master'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('page.monitoring')) = 0;
