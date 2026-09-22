-- Outil de devis — schéma SQLite 3
-- Fichier compilé : database/devis.db (script database/build.mjs)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

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

CREATE TABLE dv_artisans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  metier TEXT NOT NULL DEFAULT 'Électricité',
  slug TEXT UNIQUE,
  ville TEXT,
  telephone TEXT,
  bio TEXT
);

CREATE TABLE dv_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  artisan_id INTEGER NOT NULL REFERENCES dv_artisans(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  status TEXT NOT NULL DEFAULT 'nouveau'
    CHECK (status IN ('nouveau','contacte','devis_envoye','gagne','perdu','archive')),
  source TEXT NOT NULL DEFAULT 'widget',
  priorite TEXT NOT NULL DEFAULT 'normale'
    CHECK (priorite IN ('faible','normale','haute')),
  rappel_at TEXT,
  notes_internes TEXT,
  prix_reel_ht REAL,
  prix_reel_at TEXT,

  prenom TEXT NOT NULL,
  nom TEXT,
  telephone TEXT NOT NULL,
  email TEXT NOT NULL,
  adresse TEXT,
  code_postal TEXT NOT NULL,
  ville TEXT,

  surface_m2 REAL,
  anciennete TEXT,
  urgence TEXT,
  details TEXT,
  tableau_existant TEXT,
  acces_logement TEXT,
  mise_a_terre TEXT,
  circuits_estimes TEXT,
  pieces_concernees TEXT,
  projet_associe TEXT,

  hidden_at TEXT,
  consent_rgpd INTEGER NOT NULL DEFAULT 0,
  client_ip TEXT,
  user_agent TEXT
);

CREATE INDEX idx_lead_artisan_status ON dv_leads (artisan_id, status);
CREATE INDEX idx_lead_created ON dv_leads (created_at DESC);
CREATE INDEX idx_lead_email ON dv_leads (email);
CREATE INDEX idx_lead_cp ON dv_leads (code_postal);
CREATE INDEX idx_lead_hidden ON dv_leads (artisan_id, hidden_at);

CREATE TABLE dv_lead_travaux (
  lead_id INTEGER NOT NULL REFERENCES dv_leads(id) ON DELETE CASCADE,
  travaux TEXT NOT NULL,
  PRIMARY KEY (lead_id, travaux)
);

CREATE TABLE dv_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES dv_leads(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  analyzed_at TEXT,
  kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'video')),
  titre TEXT,
  filename TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  storage_path TEXT
);

CREATE INDEX idx_photo_lead ON dv_photos (lead_id, sort_order);

CREATE TABLE dv_photo_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES dv_leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'envoyee'
    CHECK (status IN ('envoyee','recue','annulee')),
  note TEXT
);

CREATE INDEX idx_preq_lead ON dv_photo_requests (lead_id, created_at DESC);

CREATE TABLE dv_photo_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES dv_photo_requests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hint TEXT
);

CREATE TABLE dv_ai_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES dv_leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  price_min_ht REAL NOT NULL,
  price_max_ht REAL NOT NULL,
  complexity TEXT NOT NULL CHECK (complexity IN ('simple','moyen','complexe')),
  confidence TEXT NOT NULL CHECK (confidence IN ('debutant','calibre','fiable')),
  confidence_note TEXT,
  observations TEXT
);

CREATE INDEX idx_ai_lead ON dv_ai_estimates (lead_id, created_at DESC);

CREATE TABLE dv_ai_prestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES dv_ai_estimates(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  amount_ht REAL NOT NULL
);

CREATE INDEX idx_presta_est ON dv_ai_prestations (estimate_id, sort_order);

CREATE TABLE dv_ai_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimate_id INTEGER NOT NULL REFERENCES dv_ai_estimates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('alerte','recommandation')),
  message TEXT NOT NULL
);

CREATE TABLE dv_lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES dv_leads(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX idx_event_lead ON dv_lead_events (lead_id, created_at);
