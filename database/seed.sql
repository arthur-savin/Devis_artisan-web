-- Données de démonstration (Léa / Karim / Sophie)
-- Compatible SQLite et MySQL si les tables existent déjà.

INSERT INTO dv_artisans (id, public_id, created_at, email, password_hash, display_name, metier, slug, ville, bio) VALUES
(1, 'art_demo_01', '2026-03-01 09:00:00.000', 'vous@atelier.fr', NULL, 'Atelier Lyon', 'Électricité', 'atelier-lyon', 'Lyon', 'Électricité pour particuliers — devis sous 24 h, sans engagement.');

INSERT INTO dv_leads (
  id, public_id, artisan_id, created_at, updated_at,
  status, source, priorite, rappel_at, notes_internes, prix_reel_ht, prix_reel_at,
  prenom, nom, telephone, email, adresse, code_postal, ville,
  surface_m2, anciennete, urgence, details,
  tableau_existant, acces_logement, mise_a_terre, circuits_estimes, pieces_concernees, projet_associe,
  consent_rgpd
) VALUES
(
  1, 'dv_seed_01', 1, '2026-09-09 16:12:00.000', '2026-09-09 18:17:00.000',
  'nouveau', 'widget', 'haute', '2026-09-10',
  'Rappeler ce soir après 19h (disjonctions). Demander s’il y a un diagnostic DPE / élec déjà fait. Accès 3e sans ascenseur → prévoir 2 passages matériel.',
  NULL, NULL,
  'Léa', 'Martin', '06 18 44 21 09', 'lea.martin@email.fr', '14 rue de la Part-Dieu', '69003', 'Lyon',
  72, 'Plus de 30 ans', 'Urgent',
  'Disjonctions à répétition depuis hier soir. Tableau dans l’entrée, à gauche en arrivant. Cuisine à refaire dans les semaines qui viennent — prévoir des départs supplémentaires.',
  'Oui — 8 modules, sans différentiel 30 mA',
  'Interphone + code, 3e étage sans ascenseur',
  'Incertaine — à vérifier sur place',
  '≈ 9 circuits',
  'Ensemble du logement',
  'Disjonctions + rénovation cuisine',
  1
),
(
  2, 'dv_seed_02', 1, '2026-09-08 09:00:00.000', '2026-09-08 14:30:00.000',
  'contacte', 'widget', 'normale', '2026-09-11',
  'Appel prévu : diagnostic avant emménagement.',
  NULL, NULL,
  'Karim', NULL, '07 52 10 88 34', 'karim.b@email.fr', NULL, '69100', 'Villeurbanne',
  110, '10 à 30 ans', 'Dans le mois',
  'Achat d’un appartement, diagnostic électrique à prévoir avant emménagement.',
  NULL, NULL, NULL, NULL, NULL, NULL, 1
),
(
  3, 'dv_seed_03', 1, '2026-09-05 10:00:00.000', '2026-09-07 16:00:00.000',
  'devis_envoye', 'widget', 'faible', NULL,
  'Devis borne envoyé par e-mail. Relance si pas de réponse sous 10 jours.',
  NULL, NULL,
  'Sophie', 'Durand', '06 03 77 15 62', 'sophie.durand@email.fr', NULL, '69008', 'Lyon',
  95, 'Moins de 10 ans', 'Pas urgent',
  'Maison individuelle, place de parking privative, véhicule commandé pour novembre.',
  NULL, NULL, NULL, NULL, NULL, 'Borne VE à domicile', 1
);

INSERT INTO dv_lead_travaux (lead_id, travaux) VALUES
(1, 'Mise aux normes'),
(2, 'Mise aux normes'),
(3, 'Borne de recharge');

INSERT INTO dv_photos (id, lead_id, sort_order, created_at, analyzed_at, kind, titre, filename, mime_type, size_bytes, storage_path) VALUES
(1, 1, 1, '2026-09-09 16:12:20.000', '2026-09-09 16:14:00.000', 'photo', 'Tableau électrique — entrée', 'tableau.jpg', 'image/jpeg', 2516582, 'placeholder:ph-navy'),
(2, 1, 2, '2026-09-09 16:12:21.000', '2026-09-09 16:14:00.000', 'photo', 'Cuisine — arrivées existantes', 'cuisine.jpg', 'image/jpeg', 1887436, 'placeholder:ph-clay'),
(3, 1, 3, '2026-09-09 16:12:22.000', '2026-09-09 16:14:00.000', 'photo', 'Séjour — plafonnier', 'sejour.jpg', 'image/jpeg', 2202009, 'placeholder:ph-sage'),
(4, 1, 4, '2026-09-09 16:12:23.000', '2026-09-09 16:14:00.000', 'photo', 'Dégagement — gaine apparente', 'degagement.jpg', 'image/jpeg', 1677721, 'placeholder:ph-slate');

INSERT INTO dv_ai_estimates (
  id, lead_id, created_at, price_min_ht, price_max_ht, complexity, confidence, confidence_note, observations
) VALUES (
  1, 1, '2026-09-09 16:14:00.000', 3200, 4800, 'complexe', 'calibre',
  'Fourchette large : le tableau n’est photographié que de face, les sections de câbles restent à contrôler.',
  'Installation d’origine (~ années 80). Absence probable de différentiel 30 mA. Les disjonctions répétées collent avec un tableau saturé et des départs cuisine sous-dimensionnés. Visite indispensable avant devis ferme.'
);

INSERT INTO dv_ai_prestations (estimate_id, sort_order, label, amount_ht) VALUES
(1, 1, 'Diagnostic électrique + schéma unifilaire', 180),
(1, 2, 'Tableau 13 modules + 2 × 30 mA', 890),
(1, 3, 'Mise à la terre + liaison équipotentielle', 420),
(1, 4, 'Remplacement 12 prises + 8 points lumineux', 1140),
(1, 5, 'Saignées / reprises plâtre (forfait)', 650),
(1, 6, 'Main-d’œuvre + Consuel', 720);

INSERT INTO dv_ai_flags (estimate_id, kind, message) VALUES
(1, 'alerte', 'Installation ancienne détectée : prévoir un diagnostic avant toute intervention, et vérifier la présence d’amiante sur les colliers / gaines.'),
(1, 'recommandation', 'Prévoir 1 jour supplémentaire si le tableau dépasse 9 circuits. Emporter un testeur de terre et un stock de disjoncteurs 16/20 A.');

INSERT INTO dv_lead_events (lead_id, created_at, kind, message) VALUES
(1, '2026-09-09 16:12:00.000', 'recue', 'Demande reçue'),
(1, '2026-09-09 16:14:00.000', 'analyse_ia', 'Analyse IA terminée'),
(1, '2026-09-09 18:17:00.000', 'consulte', 'Consulté par l’artisan'),
(2, '2026-09-08 09:00:00.000', 'recue', 'Demande reçue'),
(2, '2026-09-08 14:30:00.000', 'statut', 'Statut : Contacté'),
(3, '2026-09-05 10:00:00.000', 'recue', 'Demande reçue'),
(3, '2026-09-07 16:00:00.000', 'statut', 'Statut : Devis envoyé');
