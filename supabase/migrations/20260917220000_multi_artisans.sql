-- Plusieurs ateliers : page publique + dashboard isolé
-- Idempotent : peut être relancé.

alter table dv_artisans add column if not exists slug text;
alter table dv_artisans add column if not exists ville text;
alter table dv_artisans add column if not exists telephone text;
alter table dv_artisans add column if not exists bio text;

update dv_artisans
set slug = coalesce(nullif(btrim(slug), ''), 'atelier-lyon')
where public_id = 'art_demo_01';

update dv_artisans
set slug = coalesce(nullif(btrim(slug), ''), public_id)
where slug is null or btrim(slug) = '';

create unique index if not exists uq_dv_artisans_slug on dv_artisans (slug);

drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text);
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text);

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
  p_artisan_public_id text default null
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
    artisan_id, prenom, telephone, email, code_postal,
    surface_m2, anciennete, urgence, details,
    source, status, consent_rgpd, user_agent
  ) values (
    v_artisan, p_prenom, p_telephone, p_email, p_code_postal,
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

create or replace function dv_register_artisan(
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

create or replace function dv_public_artisan(p_ref text)
returns table (
  public_id text,
  slug text,
  display_name text,
  metier text,
  ville text,
  telephone text,
  bio text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.public_id, a.slug, a.display_name, a.metier, a.ville, a.telephone, a.bio
  from dv_artisans a
  where a.slug = p_ref or a.public_id = p_ref
  limit 1;
$$;

drop policy if exists leads_select_auth on dv_leads;
drop policy if exists leads_update_auth on dv_leads;
drop policy if exists leads_delete_auth on dv_leads;

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

grant execute on function dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text) to anon, authenticated;
grant execute on function dv_register_artisan(text, text, text, text, text, text) to authenticated;
grant execute on function dv_public_artisan(text) to anon, authenticated;
