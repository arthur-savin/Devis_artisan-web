-- Anciens devis déposés par l’artisan pour calibrer l’IA.
-- Le fichier est stocké ici. Les lignes lues (prestation + prix HT)
-- sont enregistrées dans dv_service_prices, la même table que les
-- prix corrigés par l’artisan après une estimation.

create table if not exists dv_service_prices (
  id bigint generated always as identity primary key,
  artisan_id bigint not null references dv_artisans(id) on delete cascade,
  service_label text not null,
  amount_ht numeric(10,2) not null check (amount_ht > 0),
  previous_amount_ht numeric(10,2),
  reason text,
  lead_id bigint references dv_leads(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_prices_artisan
  on dv_service_prices (artisan_id, created_at desc);

alter table dv_service_prices enable row level security;

drop policy if exists service_prices_select_own on dv_service_prices;
create policy service_prices_select_own on dv_service_prices
  for select to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

create table if not exists dv_quote_imports (
  id bigint generated always as identity primary key,
  artisan_id bigint not null references dv_artisans(id) on delete cascade,
  created_at timestamptz not null default now(),
  filename text not null,
  mime_type text not null,
  size_bytes integer,
  storage_path text not null,
  status text not null default 'en_attente'
    check (status in ('en_attente', 'en_cours', 'extrait', 'erreur')),
  error_message text,
  title text,
  extracted_at timestamptz
);

create index if not exists idx_quote_imports_artisan
  on dv_quote_imports (artisan_id, created_at desc);

alter table dv_quote_imports enable row level security;

drop policy if exists quote_imports_select_own on dv_quote_imports;
create policy quote_imports_select_own on dv_quote_imports
  for select to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

drop policy if exists quote_imports_insert_own on dv_quote_imports;
create policy quote_imports_insert_own on dv_quote_imports
  for insert to authenticated
  with check (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

drop policy if exists quote_imports_delete_own on dv_quote_imports;
create policy quote_imports_delete_own on dv_quote_imports
  for delete to authenticated
  using (artisan_id in (select id from dv_artisans where auth_user_id = auth.uid()));

alter table dv_service_prices add column if not exists source text not null default 'correction';
alter table dv_service_prices add column if not exists detail text;
alter table dv_service_prices add column if not exists import_id bigint;

do $$
begin
  alter table dv_service_prices
    add constraint dv_service_prices_source_check
    check (source in ('correction', 'import'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table dv_service_prices
    add constraint dv_service_prices_import_id_fkey
    foreign key (import_id) references dv_quote_imports(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_service_prices_import
  on dv_service_prices (import_id);

grant select on dv_service_prices to authenticated;
grant select, insert, delete on dv_quote_imports to authenticated;

insert into storage.buckets (id, name, public)
values ('devis-archives', 'devis-archives', false)
on conflict (id) do nothing;

drop policy if exists devis_archives_insert_own on storage.objects;
drop policy if exists devis_archives_select_own on storage.objects;
drop policy if exists devis_archives_delete_own on storage.objects;

create policy devis_archives_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'devis-archives'
    and (storage.foldername(name))[1] = (
      select id::text from dv_artisans where auth_user_id = auth.uid() limit 1
    )
  );

create policy devis_archives_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'devis-archives'
    and (storage.foldername(name))[1] = (
      select id::text from dv_artisans where auth_user_id = auth.uid() limit 1
    )
  );

create policy devis_archives_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'devis-archives'
    and (storage.foldername(name))[1] = (
      select id::text from dv_artisans where auth_user_id = auth.uid() limit 1
    )
  );
