-- Champs du formulaire complétés par l'IA à partir des photos,
-- uniquement lorsque le client ne les a pas saisis.

alter table dv_leads add column if not exists releve_ia jsonb;
