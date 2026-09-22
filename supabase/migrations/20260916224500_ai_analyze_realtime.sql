-- La fiche artisan se rafraîchit quand l’IA a fini d’écrire.
do $$
begin
  alter publication supabase_realtime add table dv_ai_estimates;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table dv_lead_events;
exception
  when duplicate_object then null;
end $$;
