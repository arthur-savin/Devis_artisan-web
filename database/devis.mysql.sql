-- Outil de devis — schéma MySQL 8+ / MariaDB 10.5+
-- À importer sur Hostinger (ou autre) quand le widget/dashboard
-- quittera le localStorage pour une vraie API.
--
-- Couvre : demande client (widget), suivi artisan (dashboard),
-- fiche lead, photos, demandes de clichés, estimation IA, historique.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS dv_lead_events;
DROP TABLE IF EXISTS dv_ai_flags;
DROP TABLE IF EXISTS dv_ai_prestations;
DROP TABLE IF EXISTS dv_ai_estimates;
DROP TABLE IF EXISTS dv_photo_request_items;
DROP TABLE IF EXISTS dv_photo_requests;
DROP TABLE IF EXISTS dv_photos;
DROP TABLE IF EXISTS dv_lead_travaux;
DROP TABLE IF EXISTS dv_leads;
DROP TABLE IF EXISTS dv_artisans;

SET FOREIGN_KEY_CHECKS = 1;

-- Compte dashboard (un atelier / un artisan pour commencer)
CREATE TABLE dv_artisans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NULL COMMENT 'NULL tant que la démo n’a pas d’auth réelle',
  display_name VARCHAR(160) NOT NULL,
  metier VARCHAR(80) NOT NULL DEFAULT 'Électricité',
  slug VARCHAR(80) NULL,
  ville VARCHAR(120) NULL,
  telephone VARCHAR(32) NULL,
  bio TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_artisan_public (public_id),
  UNIQUE KEY uq_artisan_email (email),
  UNIQUE KEY uq_artisan_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une demande de devis = un lead
CREATE TABLE dv_leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id VARCHAR(32) NOT NULL,
  artisan_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  status VARCHAR(24) NOT NULL DEFAULT 'nouveau'
    COMMENT 'nouveau | contacte | devis_envoye | gagne | perdu | archive',
  source VARCHAR(40) NOT NULL DEFAULT 'widget',
  priorite VARCHAR(16) NOT NULL DEFAULT 'normale'
    COMMENT 'faible | normale | haute',
  rappel_at DATE NULL,
  notes_internes TEXT NULL,
  prix_reel_ht DECIMAL(10,2) NULL COMMENT 'Renseigné seulement si statut = gagne',
  prix_reel_at DATETIME(3) NULL,

  -- Client
  prenom VARCHAR(120) NOT NULL,
  nom VARCHAR(120) NULL,
  telephone VARCHAR(40) NOT NULL,
  email VARCHAR(254) NOT NULL,
  adresse VARCHAR(255) NULL,
  code_postal CHAR(5) NOT NULL,
  ville VARCHAR(120) NULL,

  -- Réponses formulaire widget
  surface_m2 DECIMAL(7,1) NULL,
  anciennete VARCHAR(40) NULL,
  urgence VARCHAR(40) NULL,
  details TEXT NULL,
  tableau_existant VARCHAR(255) NULL,
  acces_logement VARCHAR(255) NULL,
  mise_a_terre VARCHAR(255) NULL,
  circuits_estimes VARCHAR(80) NULL,
  pieces_concernees VARCHAR(255) NULL,
  projet_associe VARCHAR(255) NULL,

  hidden_at DATETIME(3) NULL COMMENT 'NULL = visible dashboard ; non NULL = masquée, données conservées pour l’IA',
  consent_rgpd TINYINT(1) NOT NULL DEFAULT 0,
  client_ip VARCHAR(45) NULL,
  user_agent VARCHAR(512) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_public (public_id),
  KEY idx_lead_artisan_status (artisan_id, status),
  KEY idx_lead_created (created_at DESC),
  KEY idx_lead_email (email),
  KEY idx_lead_cp (code_postal),
  KEY idx_lead_hidden (artisan_id, hidden_at),
  CONSTRAINT fk_lead_artisan
    FOREIGN KEY (artisan_id) REFERENCES dv_artisans (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Types de travaux (plusieurs choix possibles dans le widget)
CREATE TABLE dv_lead_travaux (
  lead_id BIGINT UNSIGNED NOT NULL,
  travaux VARCHAR(80) NOT NULL,
  PRIMARY KEY (lead_id, travaux),
  CONSTRAINT fk_travaux_lead
    FOREIGN KEY (lead_id) REFERENCES dv_leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dv_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  analyzed_at DATETIME(3) NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'photo'
    COMMENT 'photo | video',
  titre VARCHAR(160) NULL,
  filename VARCHAR(255) NULL,
  mime_type VARCHAR(80) NULL,
  size_bytes INT UNSIGNED NULL,
  storage_path VARCHAR(512) NULL COMMENT 'Chemin fichier ou URL ; en démo : placeholder',
  PRIMARY KEY (id),
  KEY idx_photo_lead (lead_id, sort_order),
  CONSTRAINT fk_photo_lead
    FOREIGN KEY (lead_id) REFERENCES dv_leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Demande artisan → client pour de nouveaux clichés
CREATE TABLE dv_photo_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status VARCHAR(24) NOT NULL DEFAULT 'envoyee'
    COMMENT 'envoyee | recue | annulee',
  note TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_preq_lead (lead_id, created_at DESC),
  CONSTRAINT fk_preq_lead
    FOREIGN KEY (lead_id) REFERENCES dv_leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dv_photo_request_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(200) NOT NULL,
  hint VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_preq_item (request_id),
  CONSTRAINT fk_preq_item_request
    FOREIGN KEY (request_id) REFERENCES dv_photo_requests (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Une estimation IA par lead (la plus récente est celle à afficher)
CREATE TABLE dv_ai_estimates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  price_min_ht DECIMAL(10,2) NOT NULL,
  price_max_ht DECIMAL(10,2) NOT NULL,
  complexity VARCHAR(16) NOT NULL COMMENT 'simple | moyen | complexe',
  confidence VARCHAR(16) NOT NULL COMMENT 'debutant | calibre | fiable',
  confidence_note TEXT NULL,
  observations TEXT NULL,
  PRIMARY KEY (id),
  KEY idx_ai_lead (lead_id, created_at DESC),
  CONSTRAINT fk_ai_lead
    FOREIGN KEY (lead_id) REFERENCES dv_leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dv_ai_prestations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estimate_id BIGINT UNSIGNED NOT NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 1,
  label VARCHAR(255) NOT NULL,
  amount_ht DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_presta_est (estimate_id, sort_order),
  CONSTRAINT fk_presta_estimate
    FOREIGN KEY (estimate_id) REFERENCES dv_ai_estimates (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dv_ai_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estimate_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(24) NOT NULL COMMENT 'alerte | recommandation',
  message TEXT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flag_est (estimate_id),
  CONSTRAINT fk_flag_estimate
    FOREIGN KEY (estimate_id) REFERENCES dv_ai_estimates (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dv_lead_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  kind VARCHAR(40) NOT NULL
    COMMENT 'recue | analyse_ia | consulte | statut | photos_demandees | note | manuel',
  message VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_event_lead (lead_id, created_at),
  CONSTRAINT fk_event_lead
    FOREIGN KEY (lead_id) REFERENCES dv_leads (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
