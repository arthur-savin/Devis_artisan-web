-- Le client peut préciser le résumé IA depuis le widget (anonyme).
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
