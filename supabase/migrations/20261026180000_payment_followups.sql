-- Suivi des paiements rattaché aux demandes de devis.
-- Un client passé en « devis envoyé » obtient une ligne ici,
-- liée à dv_leads, pour les relances jusqu’au paiement.
-- Idempotent.

create table if not exists dv_payment_settings (
  artisan_id bigint primary key references dv_artisans(id) on delete cascade,
  iban text not null default '',
  payment_link text not null default '',
  delay_days integer not null default 30,
  steps jsonb not null default '[
    {"offset":-3,"label":"Rappel cordial","tone":1},
    {"offset":3,"label":"Relance","tone":2},
    {"offset":10,"label":"Relance ferme","tone":3},
    {"offset":20,"label":"Mise en demeure","tone":4}
  ]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists dv_payment_invoices (
  id bigint generated always as identity primary key,
  public_id text not null unique default ('inv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  artisan_id bigint not null references dv_artisans(id) on delete cascade,
  lead_id bigint references dv_leads(id) on delete set null,
  lead_public_id text,
  client_name text not null,
  client_email text not null default '',
  label text not null default '',
  number text not null,
  amount_ttc numeric(12,2) not null default 0,
  issued_on date not null,
  due_on date not null,
  paid_at timestamptz,
  reminders jsonb not null default '[]'::jsonb,
  last_step integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dv_payment_invoices_one_lead
  on dv_payment_invoices (artisan_id, lead_public_id)
  where lead_public_id is not null;

create index if not exists idx_payment_invoices_artisan
  on dv_payment_invoices (artisan_id, created_at desc);

alter table dv_payment_settings enable row level security;
alter table dv_payment_invoices enable row level security;

drop policy if exists payment_settings_own on dv_payment_settings;
create policy payment_settings_own on dv_payment_settings
  for all to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()))
  with check (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

drop policy if exists payment_invoices_own on dv_payment_invoices;
create policy payment_invoices_own on dv_payment_invoices
  for all to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()))
  with check (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));
