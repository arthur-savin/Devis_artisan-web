-- Pré-chiffrage : résumé client conservé, barème indicatif par artisan,
-- remplacement d'estimation dans une seule transaction.

alter table dv_artisans add column if not exists bareme_indicatif text;
alter table dv_artisans add column if not exists bareme_autorise boolean not null default false;

create or replace function dv_save_price_sources(
  p_tarif text,
  p_bareme text,
  p_bareme_autorise boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Connexion requise pour enregistrer les tarifs.';
  end if;
  update dv_artisans
  set tarif_grid = nullif(btrim(coalesce(p_tarif, '')), ''),
      bareme_indicatif = nullif(btrim(coalesce(p_bareme, '')), ''),
      bareme_autorise = coalesce(p_bareme_autorise, false)
  where auth_user_id = v_uid;
  if not found then
    raise exception 'Aucun atelier lié à ce compte.';
  end if;
end;
$$;

revoke all on function dv_save_price_sources(text, text, boolean) from public;
grant execute on function dv_save_price_sources(text, text, boolean) to authenticated;

create or replace function dv_replace_lead_estimate(
  p_lead_id bigint,
  p_price_min_ht numeric,
  p_price_max_ht numeric,
  p_complexity text,
  p_confidence text,
  p_confidence_note text,
  p_observations text,
  p_client_summary text,
  p_prestations jsonb,
  p_flags jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_item jsonb;
  v_i int := 0;
begin
  if p_lead_id is null then
    raise exception 'lead requis';
  end if;
  if p_complexity not in ('simple', 'moyen', 'complexe') then
    raise exception 'complexity hors liste';
  end if;
  if p_confidence not in ('debutant', 'calibre', 'fiable') then
    raise exception 'confidence hors liste';
  end if;

  insert into dv_ai_estimates (
    lead_id,
    price_min_ht,
    price_max_ht,
    complexity,
    confidence,
    confidence_note,
    observations,
    client_summary,
    has_price
  ) values (
    p_lead_id,
    p_price_min_ht,
    p_price_max_ht,
    p_complexity,
    p_confidence,
    nullif(btrim(coalesce(p_confidence_note, '')), ''),
    nullif(btrim(coalesce(p_observations, '')), ''),
    coalesce(nullif(btrim(coalesce(p_client_summary, '')), ''), 'Votre demande a bien été analysée, l''artisan reviendra vers vous.'),
    coalesce(p_price_max_ht, 0) > 0
  )
  returning id into v_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_prestations, '[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into dv_ai_prestations (estimate_id, sort_order, label, amount_ht)
    values (
      v_id,
      coalesce(nullif(v_item->>'sort_order', '')::int, v_i),
      left(btrim(coalesce(v_item->>'label', '')), 80),
      round(coalesce((v_item->>'amount_ht')::numeric, 0), 2)
    );
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_flags, '[]'::jsonb))
  loop
    if coalesce(v_item->>'kind', '') in ('alerte', 'recommandation')
       and length(btrim(coalesce(v_item->>'message', ''))) >= 8 then
      insert into dv_ai_flags (estimate_id, kind, message)
      values (
        v_id,
        v_item->>'kind',
        left(btrim(v_item->>'message'), 400)
      );
    end if;
  end loop;

  delete from dv_ai_estimates
  where lead_id = p_lead_id
    and id <> v_id;

  return v_id;
end;
$$;

revoke all on function dv_replace_lead_estimate(bigint, numeric, numeric, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function dv_replace_lead_estimate(bigint, numeric, numeric, text, text, text, text, text, jsonb, jsonb) to service_role;
