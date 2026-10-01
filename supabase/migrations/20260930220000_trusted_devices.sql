-- Navigateurs déjà confirmés par code e-mail / SMS.
-- Un nouveau navigateur redemande les codes. Le même les saute.

create table if not exists dv_trusted_devices (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (auth_user_id, device_id)
);

alter table dv_trusted_devices enable row level security;

drop policy if exists trusted_devices_own on dv_trusted_devices;
create policy trusted_devices_own on dv_trusted_devices
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

grant select, insert, update, delete on dv_trusted_devices to authenticated;
