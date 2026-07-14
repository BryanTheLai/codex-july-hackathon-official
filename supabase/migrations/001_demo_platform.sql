begin;

create table public.demo_state (
  workspace_id text primary key,
  schema_version integer not null,
  revision bigint not null,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint demo_state_workspace_id_check
    check (length(btrim(workspace_id)) between 1 and 128),
  constraint demo_state_schema_version_check
    check (schema_version > 0),
  constraint demo_state_revision_check
    check (revision > 0),
  constraint demo_state_state_check
    check (jsonb_typeof(state) = 'object')
);

create table public.telegram_events (
  update_id bigint primary key,
  workspace_id text not null
    references public.demo_state (workspace_id) on delete restrict,
  payload_hash text not null,
  status text not null,
  normalized_message_id text not null,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_events_payload_hash_check
    check (length(btrim(payload_hash)) > 0),
  constraint telegram_events_status_check
    check (status in ('received', 'processed', 'duplicate', 'failed')),
  constraint telegram_events_message_id_check
    check (length(btrim(normalized_message_id)) > 0),
  constraint telegram_events_error_check
    check (status <> 'failed' or error is not null)
);

create index telegram_events_workspace_status_idx
  on public.telegram_events (workspace_id, status, updated_at desc);

create table public.telegram_deliveries (
  request_id text not null,
  part text not null,
  workspace_id text not null
    references public.demo_state (workspace_id) on delete restrict,
  conversation_id text not null,
  target_language text not null,
  approved_text text not null,
  approved_text_hash text not null,
  status text not null,
  workspace_sync_status text not null,
  provider_message_id text,
  provider_accepted_at timestamptz,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (request_id, part),
  constraint telegram_deliveries_request_id_check
    check (length(btrim(request_id)) between 1 and 128),
  constraint telegram_deliveries_part_check
    check (part in ('text', 'voice')),
  constraint telegram_deliveries_conversation_id_check
    check (length(btrim(conversation_id)) > 0),
  constraint telegram_deliveries_target_language_check
    check (length(btrim(target_language)) between 1 and 64),
  constraint telegram_deliveries_text_check
    check (length(btrim(approved_text)) between 1 and 4096),
  constraint telegram_deliveries_text_hash_check
    check (length(btrim(approved_text_hash)) > 0),
  constraint telegram_deliveries_status_check
    check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint telegram_deliveries_sync_status_check
    check (workspace_sync_status in ('pending', 'synced')),
  constraint telegram_deliveries_provider_message_check
    check (
      status <> 'sent'
      or (provider_message_id is not null and provider_accepted_at is not null)
    ),
  constraint telegram_deliveries_error_check
    check (status <> 'failed' or error is not null)
);

create index telegram_deliveries_workspace_status_idx
  on public.telegram_deliveries (workspace_id, status, updated_at desc);

create index telegram_deliveries_pending_sync_idx
  on public.telegram_deliveries (workspace_id, updated_at)
  where workspace_sync_status = 'pending';

-- SUPABASE ACCESS START
alter table public.demo_state enable row level security;
alter table public.telegram_events enable row level security;
alter table public.telegram_deliveries enable row level security;

revoke all on table public.demo_state from anon, authenticated;
revoke all on table public.telegram_events from anon, authenticated;
revoke all on table public.telegram_deliveries from anon, authenticated;

grant select, insert, update, delete on table public.demo_state to service_role;
grant select, insert, update, delete on table public.telegram_events to service_role;
grant select, insert, update, delete on table public.telegram_deliveries to service_role;
-- SUPABASE ACCESS END

commit;
