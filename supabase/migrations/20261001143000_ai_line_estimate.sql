-- Fourchette estimée par l'IA quand aucun devis semblable ne couvre une tâche.
-- price_source = ia : l'artisan voit un triangle et doit confirmer.
-- price_source = artisan : prix repris d'un devis ou de la grille.

alter table dv_ai_prestations
  add column if not exists amount_min_ht numeric(10,2),
  add column if not exists amount_max_ht numeric(10,2),
  add column if not exists price_source text not null default 'artisan';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dv_ai_prestations_price_source_check'
  ) then
    alter table dv_ai_prestations
      add constraint dv_ai_prestations_price_source_check
      check (price_source in ('artisan', 'ia'));
  end if;
end $$;

create or replace function dv_record_service_price(
  p_lead_public_id text,
  p_label text,
  p_amount numeric,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_artisan_id bigint;
  v_lead_id bigint;
  v_estimate_id bigint;
  v_prev numeric;
  v_min numeric;
  v_max numeric;
  v_label text := left(nullif(btrim(coalesce(p_label, '')), ''), 200);
  v_amount numeric := round(p_amount, 2);
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_amount_txt text;
begin
  if v_uid is null then
    raise exception 'Connexion requise pour enregistrer un prix.';
  end if;
  if v_label is null then
    raise exception 'Type de service manquant.';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Indiquez un prix valide.';
  end if;

  select id into v_artisan_id
  from dv_artisans
  where auth_user_id = v_uid;

  if v_artisan_id is null then
    raise exception 'Aucun atelier lié à ce compte.';
  end if;

  select id into v_lead_id
  from dv_leads
  where public_id = p_lead_public_id
    and artisan_id = v_artisan_id;

  if v_lead_id is null then
    raise exception 'Demande introuvable.';
  end if;

  select e.id
    into v_estimate_id
  from dv_ai_estimates e
  where e.lead_id = v_lead_id
  order by e.created_at desc
  limit 1;

  if v_estimate_id is not null then
    select amount_ht into v_prev
    from dv_ai_prestations
    where estimate_id = v_estimate_id
      and label = v_label
    order by sort_order
    limit 1;

    update dv_ai_prestations
    set
      amount_ht = v_amount,
      amount_min_ht = v_amount,
      amount_max_ht = v_amount,
      price_source = 'artisan'
    where estimate_id = v_estimate_id
      and label = v_label;

    if found then
      select
        coalesce(sum(coalesce(amount_min_ht, amount_ht)), 0),
        coalesce(sum(coalesce(amount_max_ht, amount_ht)), 0)
      into v_min, v_max
      from dv_ai_prestations
      where estimate_id = v_estimate_id;
      update dv_ai_estimates
      set
        has_price = v_max > 0,
        price_min_ht = v_min,
        price_max_ht = greatest(v_min, v_max)
      where id = v_estimate_id;
    end if;
  end if;

  insert into dv_service_prices (
    artisan_id, service_label, amount_ht, previous_amount_ht, reason, lead_id
  ) values (
    v_artisan_id, v_label, v_amount, v_prev, v_reason, v_lead_id
  );

  v_amount_txt := regexp_replace(
    replace(trim(to_char(v_amount, 'FM999999990.00')), '.', ','),
    ',00$',
    ''
  );

  insert into dv_lead_events (lead_id, kind, message)
  values (
    v_lead_id,
    'tarif',
    'Prix artisan — ' || v_label || ' : ' || v_amount_txt || ' € HT'
      || case when v_reason is not null then ' — ' || v_reason else '' end
  );
end;
$$;

grant execute on function dv_record_service_price(text, text, numeric, text) to authenticated;
