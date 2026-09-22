-- Outil de devis — schéma PostgreSQL pour Supabase
-- À coller dans : SQL Editor → New query → Run
-- Idempotent : peut être relancé (DROP + recreate).

create extension if not exists pgcrypto;

drop table if exists dv_lead_events cascade;
drop table if exists dv_ai_flags cascade;
drop table if exists dv_ai_prestations cascade;
drop table if exists dv_ai_estimates cascade;
drop table if exists dv_photo_request_items cascade;
drop table if exists dv_photo_requests cascade;
drop table if exists dv_photos cascade;
drop table if exists dv_lead_travaux cascade;
drop table if exists dv_leads cascade;
drop table if exists dv_artisans cascade;

drop function if exists dv_set_updated_at() cascade;
drop function if exists dv_leads_default_artisan() cascade;
drop function if exists dv_default_artisan_id() cascade;
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text);
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text);
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text, text);
drop function if exists dv_register_artisan(text, text, text, text, text, text);
drop function if exists dv_public_artisan(text);

-- ——— Artisan (un atelier) ———
create table dv_artisans (
  id bigint generated always as identity primary key,
  public_id text not null unique,
  created_at timestamptz not null default now(),
  email text not null unique,
  display_name text not null,
  metier text not null default 'Électricité',
  slug text unique,
  ville text,
  telephone text,
  bio text,
  tarif_grid text,
  auth_user_id uuid unique
);

-- ——— Demandes de devis ———
create table dv_leads (
  id bigint generated always as identity primary key,
  public_id text not null unique default ('dv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  artisan_id bigint not null references dv_artisans(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'nouveau'
    check (status in ('nouveau','contacte','devis_envoye','gagne','perdu','archive')),
  source text not null default 'widget',
  priorite text not null default 'normale'
    check (priorite in ('faible','normale','haute')),
  rappel_at date,
  notes_internes text,
  prix_reel_ht numeric(10,2),
  prix_reel_at timestamptz,

  prenom text not null,
  nom text,
  telephone text not null,
  email text not null,
  adresse text,
  code_postal text not null,
  ville text,

  surface_m2 numeric(7,1),
  anciennete text,
  urgence text,
  details text,
  tableau_existant text,
  acces_logement text,
  mise_a_terre text,
  circuits_estimes text,
  pieces_concernees text,
  projet_associe text,

  -- NULL = visible dans le tableau ; horodatage = retirée de l’UI, données conservées pour l’IA
  hidden_at timestamptz,
  consent_rgpd boolean not null default false,
  user_agent text
);

create index idx_lead_artisan_status on dv_leads (artisan_id, status);
create index idx_lead_created on dv_leads (created_at desc);
create index idx_lead_email on dv_leads (email);
create index idx_lead_cp on dv_leads (code_postal);
create index idx_lead_hidden on dv_leads (artisan_id, hidden_at);

create table dv_lead_travaux (
  lead_id bigint not null references dv_leads(id) on delete cascade,
  travaux text not null,
  primary key (lead_id, travaux)
);

create table dv_photos (
  id bigint generated always as identity primary key,
  lead_id bigint not null references dv_leads(id) on delete cascade,
  sort_order smallint not null default 1,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz,
  kind text not null default 'photo'
    check (kind in ('photo','video')),
  titre text,
  filename text,
  mime_type text,
  size_bytes integer,
  storage_path text
);

create index idx_photo_lead on dv_photos (lead_id, sort_order);

create table dv_photo_requests (
  id bigint generated always as identity primary key,
  lead_id bigint not null references dv_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'envoyee'
    check (status in ('envoyee','recue','annulee')),
  note text
);

create table dv_photo_request_items (
  id bigint generated always as identity primary key,
  request_id bigint not null references dv_photo_requests(id) on delete cascade,
  label text not null,
  hint text
);

create table dv_ai_estimates (
  id bigint generated always as identity primary key,
  lead_id bigint not null references dv_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  price_min_ht numeric(10,2),
  price_max_ht numeric(10,2),
  complexity text not null check (complexity in ('simple','moyen','complexe')),
  confidence text not null check (confidence in ('debutant','calibre','fiable')),
  confidence_note text,
  observations text,
  client_summary text,
  dossier_suffisant boolean,
  has_price boolean not null default false,
  titre_predevis text
);

create table dv_ai_prestations (
  id bigint generated always as identity primary key,
  estimate_id bigint not null references dv_ai_estimates(id) on delete cascade,
  sort_order smallint not null default 1,
  label text not null,
  detail text,
  amount_ht numeric(10,2) not null
);

create table dv_ai_flags (
  id bigint generated always as identity primary key,
  estimate_id bigint not null references dv_ai_estimates(id) on delete cascade,
  kind text not null check (kind in ('alerte','recommandation')),
  message text not null
);

create table dv_lead_events (
  id bigint generated always as identity primary key,
  lead_id bigint not null references dv_leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null,
  message text not null
);

create index idx_event_lead on dv_lead_events (lead_id, created_at);

-- ——— Triggers ———
create function dv_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_leads_updated
before update on dv_leads
for each row execute procedure dv_set_updated_at();

create function dv_default_artisan_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select id from dv_artisans order by id asc limit 1;
$$;

create function dv_leads_default_artisan()
returns trigger
language plpgsql
as $$
begin
  if new.artisan_id is null then
    new.artisan_id := dv_default_artisan_id();
  end if;
  return new;
end;
$$;

create trigger trg_leads_artisan
before insert on dv_leads
for each row execute procedure dv_leads_default_artisan();

-- Soumission publique (widget) : contourne le SELECT interdit à l’anonyme
create function dv_submit_lead(
  p_prenom text,
  p_telephone text,
  p_email text,
  p_code_postal text,
  p_surface numeric,
  p_anciennete text,
  p_urgence text,
  p_details text,
  p_travaux text[],
  p_user_agent text,
  p_artisan_public_id text default null,
  p_adresse text default null
)
returns table (id bigint, public_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_public text;
  v_artisan bigint;
begin
  select a.id into v_artisan
  from dv_artisans a
  where a.public_id = p_artisan_public_id or a.slug = p_artisan_public_id
  limit 1;

  if v_artisan is null then
    v_artisan := dv_default_artisan_id();
  end if;

  insert into dv_leads (
    artisan_id, prenom, telephone, email, adresse, code_postal,
    surface_m2, anciennete, urgence, details,
    source, status, consent_rgpd, user_agent
  ) values (
    v_artisan, p_prenom, p_telephone, p_email, nullif(btrim(p_adresse), ''), p_code_postal,
    p_surface, p_anciennete, p_urgence, p_details,
    'widget', 'nouveau', true, p_user_agent
  )
  returning dv_leads.id, dv_leads.public_id into v_id, v_public;

  if p_travaux is not null then
    insert into dv_lead_travaux (lead_id, travaux)
    select v_id, u.travaux from unnest(p_travaux) as u(travaux)
    where u.travaux is not null and btrim(u.travaux) <> '';
  end if;

  insert into dv_lead_events (lead_id, kind, message)
  values (v_id, 'recue', 'Demande reçue');

  return query select v_id, v_public;
end;
$$;

create function dv_register_artisan(
  p_display_name text,
  p_metier text,
  p_ville text,
  p_telephone text,
  p_bio text,
  p_slug text
)
returns table (id bigint, public_id text, slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_public text;
  v_slug text;
  v_base text;
  v_id bigint;
  n int := 2;
begin
  if v_uid is null then
    raise exception 'Connexion requise pour créer un atelier.';
  end if;

  select email into v_email from auth.users where auth.users.id = v_uid;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'E-mail du compte introuvable.';
  end if;

  if exists (select 1 from dv_artisans a where a.auth_user_id = v_uid) then
    return query
      select a.id, a.public_id, a.slug
      from dv_artisans a
      where a.auth_user_id = v_uid
      limit 1;
    return;
  end if;

  v_public := 'art_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_base := lower(regexp_replace(coalesce(nullif(btrim(p_slug), ''), v_public), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := v_public; end if;
  v_slug := v_base;
  while exists (select 1 from dv_artisans a where a.slug = v_slug) loop
    v_slug := v_base || '-' || n;
    n := n + 1;
  end loop;

  insert into dv_artisans (
    public_id, email, display_name, metier, ville, telephone, bio, slug, auth_user_id
  ) values (
    v_public,
    v_email,
    nullif(btrim(p_display_name), ''),
    coalesce(nullif(btrim(p_metier), ''), 'Artisan'),
    nullif(btrim(p_ville), ''),
    nullif(btrim(p_telephone), ''),
    nullif(btrim(p_bio), ''),
    v_slug,
    v_uid
  )
  returning dv_artisans.id, dv_artisans.public_id, dv_artisans.slug into v_id, v_public, v_slug;

  return query select v_id, v_public, v_slug;
end;
$$;

create function dv_public_artisan(p_ref text)
returns table (
  public_id text,
  slug text,
  display_name text,
  metier text,
  ville text,
  telephone text,
  bio text,
  has_tarif boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.public_id,
    a.slug,
    a.display_name,
    a.metier,
    a.ville,
    a.telephone,
    a.bio,
    (coalesce(btrim(a.tarif_grid), '') <> '') as has_tarif
  from dv_artisans a
  where a.slug = p_ref or a.public_id = p_ref
  limit 1;
$$;

-- ——— Seed ———
insert into dv_artisans (public_id, created_at, email, display_name, metier, slug, ville, bio, auth_user_id) values
  ('art_demo_01', '2026-03-01 09:00:00+00', 'vous@atelier.fr', 'Atelier Lyon', 'Électricité', 'atelier-lyon', 'Lyon', 'Électricité pour particuliers — devis sous 24 h, sans engagement.', 'fa95bbd6-d451-41ed-b5bb-713a3b1045e8');

insert into dv_leads (
  public_id, artisan_id, created_at, updated_at,
  status, source, priorite, rappel_at, notes_internes,
  prenom, nom, telephone, email, adresse, code_postal, ville,
  surface_m2, anciennete, urgence, details,
  tableau_existant, acces_logement, mise_a_terre, circuits_estimes,
  pieces_concernees, projet_associe, consent_rgpd
) values
(
  'dv_seed_01', 1, '2026-09-09 16:12:00+00', '2026-09-09 18:17:00+00',
  'nouveau', 'widget', 'haute', '2026-09-10',
  'Rappeler ce soir après 19h (disjonctions). Demander s’il y a un diagnostic DPE / élec déjà fait. Accès 3e sans ascenseur → prévoir 2 passages matériel.',
  'Léa', 'Martin', '06 18 44 21 09', 'lea.martin@email.fr', '14 rue de la Part-Dieu', '69003', 'Lyon',
  72, 'Plus de 30 ans', 'Urgent',
  'Disjonctions à répétition depuis hier soir. Tableau dans l’entrée, à gauche en arrivant. Cuisine à refaire dans les semaines qui viennent — prévoir des départs supplémentaires.',
  'Oui — 8 modules, sans différentiel 30 mA',
  'Interphone + code, 3e étage sans ascenseur',
  'Incertaine — à vérifier sur place',
  '≈ 9 circuits',
  'Ensemble du logement',
  'Disjonctions + rénovation cuisine',
  true
),
(
  'dv_seed_02', 1, '2026-09-08 09:00:00+00', '2026-09-08 14:30:00+00',
  'contacte', 'widget', 'normale', '2026-09-11',
  'Appel prévu : diagnostic avant emménagement.',
  'Karim', null, '07 52 10 88 34', 'karim.b@email.fr', null, '69100', 'Villeurbanne',
  110, '10 à 30 ans', 'Dans le mois',
  'Achat d’un appartement, diagnostic électrique à prévoir avant emménagement.',
  null, null, null, null, null, null, true
),
(
  'dv_seed_03', 1, '2026-09-05 10:00:00+00', '2026-09-07 16:00:00+00',
  'devis_envoye', 'widget', 'faible', null,
  'Devis borne envoyé par e-mail. Relance si pas de réponse sous 10 jours.',
  'Sophie', 'Durand', '06 03 77 15 62', 'sophie.durand@email.fr', null, '69008', 'Lyon',
  95, 'Moins de 10 ans', 'Pas urgent',
  'Maison individuelle, place de parking privative, véhicule commandé pour novembre.',
  null, null, null, null, null, 'Borne VE à domicile', true
);

insert into dv_lead_travaux (lead_id, travaux) values
  (1, 'Mise aux normes'),
  (2, 'Mise aux normes'),
  (3, 'Borne de recharge');

insert into dv_photos (lead_id, sort_order, created_at, analyzed_at, kind, titre, filename, mime_type, size_bytes, storage_path) values
  (1, 1, '2026-09-09 16:12:20+00', '2026-09-09 16:14:00+00', 'photo', 'Tableau électrique — entrée', 'tableau.jpg', 'image/jpeg', 2516582, 'placeholder:ph-navy'),
  (1, 2, '2026-09-09 16:12:21+00', '2026-09-09 16:14:00+00', 'photo', 'Cuisine — arrivées existantes', 'cuisine.jpg', 'image/jpeg', 1887436, 'placeholder:ph-clay'),
  (1, 3, '2026-09-09 16:12:22+00', '2026-09-09 16:14:00+00', 'photo', 'Séjour — plafonnier', 'sejour.jpg', 'image/jpeg', 2202009, 'placeholder:ph-sage'),
  (1, 4, '2026-09-09 16:12:23+00', '2026-09-09 16:14:00+00', 'photo', 'Dégagement — gaine apparente', 'degagement.jpg', 'image/jpeg', 1677721, 'placeholder:ph-slate');

insert into dv_ai_estimates (
  lead_id, created_at, price_min_ht, price_max_ht, complexity, confidence, confidence_note, observations
) values (
  1, '2026-09-09 16:14:00+00', 3200, 4800, 'complexe', 'calibre',
  'Fourchette large : le tableau n’est photographié que de face, les sections de câbles restent à contrôler.',
  'Installation d’origine (~ années 80). Absence probable de différentiel 30 mA. Les disjonctions répétées collent avec un tableau saturé et des départs cuisine sous-dimensionnés. Visite indispensable avant devis ferme.'
);

insert into dv_ai_prestations (estimate_id, sort_order, label, amount_ht) values
  (1, 1, 'Diagnostic électrique + schéma unifilaire', 180),
  (1, 2, 'Tableau 13 modules + 2 × 30 mA', 890),
  (1, 3, 'Mise à la terre + liaison équipotentielle', 420),
  (1, 4, 'Remplacement 12 prises + 8 points lumineux', 1140),
  (1, 5, 'Saignées / reprises plâtre (forfait)', 650),
  (1, 6, 'Main-d’œuvre + Consuel', 720);

insert into dv_ai_flags (estimate_id, kind, message) values
  (1, 'alerte', 'Installation ancienne détectée : prévoir un diagnostic avant toute intervention, et vérifier la présence d’amiante sur les colliers / gaines.'),
  (1, 'recommandation', 'Prévoir 1 jour supplémentaire si le tableau dépasse 9 circuits. Emporter un testeur de terre et un stock de disjoncteurs 16/20 A.');

insert into dv_lead_events (lead_id, created_at, kind, message) values
  (1, '2026-09-09 16:12:00+00', 'recue', 'Demande reçue'),
  (1, '2026-09-09 16:14:00+00', 'analyse_ia', 'Analyse IA terminée'),
  (1, '2026-09-09 18:17:00+00', 'consulte', 'Consulté par l’artisan'),
  (2, '2026-09-08 09:00:00+00', 'recue', 'Demande reçue'),
  (2, '2026-09-08 14:30:00+00', 'statut', 'Statut : Contacté'),
  (3, '2026-09-05 10:00:00+00', 'recue', 'Demande reçue'),
  (3, '2026-09-07 16:00:00+00', 'statut', 'Statut : Devis envoyé');

-- ——— RLS ———
-- Widget public : INSERT seulement (personne ne peut lister les leads sans compte).
-- Dashboard : SELECT / UPDATE / DELETE une fois connecté (Authentication).

alter table dv_artisans enable row level security;
alter table dv_leads enable row level security;
alter table dv_lead_travaux enable row level security;
alter table dv_photos enable row level security;
alter table dv_photo_requests enable row level security;
alter table dv_photo_request_items enable row level security;
alter table dv_ai_estimates enable row level security;
alter table dv_ai_prestations enable row level security;
alter table dv_ai_flags enable row level security;
alter table dv_lead_events enable row level security;

create policy artisans_select_auth on dv_artisans
  for select to authenticated using (true);

create policy leads_insert_public on dv_leads
  for insert to anon, authenticated with check (true);
create policy leads_select_auth on dv_leads
  for select to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));
create policy leads_update_auth on dv_leads
  for update to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()))
  with check (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));
create policy leads_delete_auth on dv_leads
  for delete to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

create policy travaux_insert_public on dv_lead_travaux
  for insert to anon, authenticated with check (true);
create policy travaux_select_auth on dv_lead_travaux
  for select to authenticated using (true);
create policy travaux_delete_auth on dv_lead_travaux
  for delete to authenticated using (true);

create policy photos_insert_public on dv_photos
  for insert to anon, authenticated with check (true);
create policy photos_select_auth on dv_photos
  for select to authenticated using (true);
create policy photos_delete_auth on dv_photos
  for delete to authenticated using (true);

create policy preq_all_auth on dv_photo_requests
  for all to authenticated using (true) with check (true);
create policy preq_items_all_auth on dv_photo_request_items
  for all to authenticated using (true) with check (true);

create policy ai_select_auth on dv_ai_estimates
  for select to authenticated using (true);
create policy ai_all_auth on dv_ai_estimates
  for all to authenticated using (true) with check (true);
create policy ai_presta_auth on dv_ai_prestations
  for all to authenticated using (true) with check (true);
create policy ai_flags_auth on dv_ai_flags
  for all to authenticated using (true) with check (true);

create policy events_insert_public on dv_lead_events
  for insert to anon, authenticated with check (true);
create policy events_select_auth on dv_lead_events
  for select to authenticated using (true);
create policy events_all_auth on dv_lead_events
  for all to authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select on dv_artisans to authenticated;
grant insert on dv_leads, dv_lead_travaux, dv_photos, dv_lead_events to anon, authenticated;
grant select, update, delete on dv_leads, dv_lead_travaux, dv_photos, dv_lead_events to authenticated;
grant all on dv_photo_requests, dv_photo_request_items, dv_ai_estimates, dv_ai_prestations, dv_ai_flags to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function dv_default_artisan_id() to anon, authenticated;
grant execute on function dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text, text) to anon, authenticated;
grant execute on function dv_register_artisan(text, text, text, text, text, text) to authenticated;
grant execute on function dv_public_artisan(text) to anon, authenticated;

create or replace function dv_public_refine_lead(p_public_id text, p_details text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_public_id is null or btrim(p_public_id) = '' then
    raise exception 'public_id requis';
  end if;

  select id into v_id from dv_leads where public_id = p_public_id limit 1;
  if v_id is null then
    raise exception 'Demande introuvable';
  end if;

  if p_details is not null and btrim(p_details) <> '' then
    update dv_leads
    set details = case
      when details is null or btrim(details) = '' then btrim(p_details)
      else details || E'\n\n--- Précision client ---\n' || btrim(p_details)
    end
    where id = v_id;

    insert into dv_lead_events (lead_id, kind, message)
    values (v_id, 'precision_client', 'Le client a précisé ou corrigé l’analyse IA');
  end if;
end;
$$;

grant execute on function dv_public_refine_lead(text, text) to anon, authenticated;

-- Realtime (liste dashboard en live)
do $$
begin
  alter publication supabase_realtime add table dv_leads;
exception
  when duplicate_object then null;
end $$;

-- Storage photos de chantier
insert into storage.buckets (id, name, public)
values ('chantier-photos', 'chantier-photos', false)
on conflict (id) do nothing;

drop policy if exists chantier_photos_insert_public on storage.objects;
drop policy if exists chantier_photos_select_auth on storage.objects;
drop policy if exists chantier_photos_delete_auth on storage.objects;

create policy chantier_photos_insert_public
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'chantier-photos');

create policy chantier_photos_select_auth
  on storage.objects for select to authenticated
  using (bucket_id = 'chantier-photos');

create policy chantier_photos_delete_auth
  on storage.objects for delete to authenticated
  using (bucket_id = 'chantier-photos');
