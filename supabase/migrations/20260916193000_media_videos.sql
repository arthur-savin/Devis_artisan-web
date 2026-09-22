-- Médias chantier : photos ET vidéos sur le même canal
-- (bucket storage chantier-photos + table dv_photos).
-- Idempotent : relançable sans DROP.

alter table dv_photos
  add column if not exists kind text;

update dv_photos
set kind = case
  when coalesce(mime_type, '') like 'video/%' then 'video'
  else 'photo'
end
where kind is null or btrim(kind) = '';

alter table dv_photos
  alter column kind set default 'photo';

alter table dv_photos
  alter column kind set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dv_photos_kind_check'
  ) then
    alter table dv_photos
      add constraint dv_photos_kind_check
      check (kind in ('photo', 'video'));
  end if;
end $$;

create index if not exists idx_photo_lead_kind on dv_photos (lead_id, kind, sort_order);
