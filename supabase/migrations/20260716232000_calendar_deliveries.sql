begin;

create table public.calendar_deliveries (
  request_id text primary key,
  workspace_id text not null
    references public.demo_state (workspace_id) on delete restrict,
  conversation_id text not null,
  calendar_uid text not null,
  calendar_sequence integer not null,
  kind text not null,
  content_hash text not null,
  status text not null,
  provider_message_id text,
  provider_accepted_at timestamptz,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_deliveries_request_id_check
    check (length(btrim(request_id)) between 1 and 128),
  constraint calendar_deliveries_conversation_id_check
    check (length(btrim(conversation_id)) between 1 and 128),
  constraint calendar_deliveries_uid_check
    check (length(btrim(calendar_uid)) between 1 and 512),
  constraint calendar_deliveries_sequence_check
    check (calendar_sequence >= 0),
  constraint calendar_deliveries_kind_check
    check (kind in ('publish', 'cancel')),
  constraint calendar_deliveries_content_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint calendar_deliveries_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'unknown')),
  constraint calendar_deliveries_provider_receipt_check
    check (
      status <> 'sent'
      or (provider_message_id is not null and provider_accepted_at is not null)
    ),
  constraint calendar_deliveries_failure_check
    check (status <> 'failed' or error is not null),
  constraint calendar_deliveries_unique_event_revision
    unique (workspace_id, calendar_uid, calendar_sequence, kind)
);

create index calendar_deliveries_workspace_status_idx
  on public.calendar_deliveries (workspace_id, status, updated_at desc);

alter table public.calendar_deliveries enable row level security;
revoke all on table public.calendar_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.calendar_deliveries to service_role;

commit;
