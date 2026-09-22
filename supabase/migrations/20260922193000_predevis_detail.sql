alter table dv_ai_prestations
  add column if not exists detail text;

alter table dv_ai_estimates
  add column if not exists titre_predevis text;
