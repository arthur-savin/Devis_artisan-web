-- Widget : enregistrer l’adresse du particulier avec le code postal
-- Idempotent : peut être relancé.

drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text);
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text);
drop function if exists dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text, text);

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

grant execute on function dv_submit_lead(text, text, text, text, numeric, text, text, text, text[], text, text, text) to anon, authenticated;
