-- Masquage dashboard : hidden_at renseigné = la demande disparaît
-- de la liste artisan. Les lignes et tables liées (photos, analyses IA,
-- événements, prix réel) restent intactes pour l’apprentissage futur.
-- Ne jamais DELETE ces leads depuis l’interface.

alter table dv_leads
  add column if not exists hidden_at timestamptz;

comment on column dv_leads.hidden_at is
  'NULL = visible dans le tableau artisan. Horodatage = retirée de l’interface, données conservées pour l’IA.';

create index if not exists idx_lead_hidden
  on dv_leads (artisan_id, hidden_at);
