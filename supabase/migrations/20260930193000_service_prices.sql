-- Prix décidés par l’artisan pour un type de service.
-- Chaque validation ajoute une ligne (avec ou sans motif).
-- Le montant de la ligne du dossier en cours est mis à jour en même temps.

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
  v_had_price boolean;
  v_sum numeric;
  v_delta numeric;
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

  select e.id, coalesce(e.has_price, false)
    into v_estimate_id, v_had_price
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
    set amount_ht = v_amount
    where estimate_id = v_estimate_id
      and label = v_label;

    if found then
      if v_had_price then
        v_delta := v_amount - coalesce(v_prev, 0);
        update dv_ai_estimates
        set
          has_price = true,
          price_min_ht = greatest(0, coalesce(price_min_ht, 0) + v_delta),
          price_max_ht = greatest(0, coalesce(price_max_ht, 0) + v_delta)
        where id = v_estimate_id;
      else
        select coalesce(sum(amount_ht), 0) into v_sum
        from dv_ai_prestations
        where estimate_id = v_estimate_id;
        update dv_ai_estimates
        set has_price = true, price_min_ht = v_sum, price_max_ht = v_sum
        where id = v_estimate_id;
      end if;
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

grant select on dv_service_prices to authenticated;
grant execute on function dv_record_service_price(text, text, numeric, text) to authenticated;
