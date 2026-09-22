-- Qualification de dossier : grille tarifaire artisan, synthèse sans prix générique.

alter table dv_artisans add column if not exists tarif_grid text;

alter table dv_ai_estimates add column if not exists client_summary text;
alter table dv_ai_estimates add column if not exists dossier_suffisant boolean;
alter table dv_ai_estimates add column if not exists has_price boolean not null default false;

alter table dv_ai_estimates alter column price_min_ht drop not null;
alter table dv_ai_estimates alter column price_max_ht drop not null;

update dv_ai_estimates
set has_price = true
where has_price = false
  and coalesce(price_min_ht, 0) > 0
  and coalesce(price_max_ht, 0) > 0;

create or replace function dv_public_artisan(p_ref text)
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

create or replace function dv_save_tarif_grid(p_tarif text)
returns table (ok boolean, has_tarif boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tarif text := nullif(btrim(coalesce(p_tarif, '')), '');
begin
  if v_uid is null then
    raise exception 'Connexion requise pour enregistrer la grille tarifaire.';
  end if;
  update dv_artisans
  set tarif_grid = v_tarif
  where auth_user_id = v_uid;
  if not found then
    raise exception 'Aucun atelier lié à ce compte.';
  end if;
  return query
    select true, (v_tarif is not null);
end;
$$;

drop policy if exists artisans_update_own on dv_artisans;
create policy artisans_update_own on dv_artisans
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

grant update (tarif_grid, display_name, metier, ville, telephone, bio) on dv_artisans to authenticated;
grant execute on function dv_public_artisan(text) to anon, authenticated;
grant execute on function dv_save_tarif_grid(text) to authenticated;
