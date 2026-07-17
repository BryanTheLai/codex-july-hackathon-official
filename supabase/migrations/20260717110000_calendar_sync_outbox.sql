begin;

-- A normalized Telegram event is retained only so the database can atomically
-- create the autonomous-reply job when inbound persistence reaches `processed`.
alter table public.telegram_events
  add column normalized_event jsonb not null default '{}'::jsonb,
  add constraint telegram_events_normalized_event_check
    check (jsonb_typeof(normalized_event) = 'object') not valid;

create table public.outbox_jobs (
  id bigint generated always as identity primary key,
  workspace_id text not null
    references public.demo_state (workspace_id) on delete restrict,
  kind text not null,
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbox_jobs_kind_check
    check (kind in ('telegram_auto_reply', 'google_calendar_sync')),
  constraint outbox_jobs_dedupe_key_check
    check (length(btrim(dedupe_key)) between 1 and 256),
  constraint outbox_jobs_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint outbox_jobs_status_check
    check (status in ('pending', 'running', 'completed', 'failed')),
  constraint outbox_jobs_attempts_check
    check (attempts >= 0 and attempts <= 20),
  constraint outbox_jobs_unique_dedupe
    unique (workspace_id, kind, dedupe_key)
);

create index outbox_jobs_ready_idx
  on public.outbox_jobs (workspace_id, available_at, id)
  where status in ('pending', 'running');

create table public.google_calendar_connections (
  workspace_id text primary key
    references public.demo_state (workspace_id) on delete restrict,
  calendar_id text not null,
  refresh_token_ciphertext text not null,
  granted_scope text not null,
  status text not null,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_calendar_id_check
    check (length(btrim(calendar_id)) between 1 and 512),
  constraint google_calendar_connections_token_check
    check (length(btrim(refresh_token_ciphertext)) between 1 and 8192),
  constraint google_calendar_connections_scope_check
    check (length(btrim(granted_scope)) between 1 and 4096),
  constraint google_calendar_connections_status_check
    check (status in ('connected', 'revoked', 'error'))
);

create table public.google_calendar_events (
  workspace_id text not null
    references public.demo_state (workspace_id) on delete restrict,
  conversation_id text not null,
  event_id text not null,
  booking_revision integer not null,
  status text not null,
  event_etag text,
  last_synced_at timestamptz not null default now(),
  primary key (workspace_id, conversation_id),
  constraint google_calendar_events_conversation_id_check
    check (length(btrim(conversation_id)) between 1 and 256),
  constraint google_calendar_events_event_id_check
    check (length(btrim(event_id)) between 5 and 1024),
  constraint google_calendar_events_booking_revision_check
    check (booking_revision > 0),
  constraint google_calendar_events_status_check
    check (status in ('active', 'cancelled'))
);

create or replace function public.enqueue_outbox_job(
  p_workspace_id text,
  p_kind text,
  p_dedupe_key text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.outbox_jobs (workspace_id, kind, dedupe_key, payload)
  values (p_workspace_id, p_kind, p_dedupe_key, p_payload)
  on conflict (workspace_id, kind, dedupe_key) do update
  set
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    available_at = now(),
    locked_at = null,
    last_error = null,
    updated_at = now()
  where public.outbox_jobs.status = 'failed';
end;
$$;

create or replace function public.enqueue_telegram_auto_reply_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'processed'
     and old.status is distinct from 'processed'
     and new.normalized_event ? 'externalEventId' then
    insert into public.outbox_jobs (workspace_id, kind, dedupe_key, payload)
    values (
      new.workspace_id,
      'telegram_auto_reply',
      'telegram:' || new.update_id::text,
      jsonb_build_object('event', new.normalized_event)
    )
    on conflict (workspace_id, kind, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger telegram_events_enqueue_auto_reply
after update of status on public.telegram_events
for each row
execute function public.enqueue_telegram_auto_reply_job();

create or replace function public.enqueue_google_calendar_sync_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation jsonb;
  booking jsonb;
  conversation_id text;
  booking_revision integer;
begin
  if not exists (
    select 1
    from public.google_calendar_connections
    where workspace_id = new.workspace_id
      and status = 'connected'
  ) then
    return new;
  end if;

  for conversation in
    select value
    from jsonb_array_elements(coalesce(new.state->'conversations', '[]'::jsonb))
  loop
    booking := conversation->'booking';
    conversation_id := conversation->>'id';
    if conversation->>'source' = 'telegram'
       and conversation_id is not null
       and jsonb_typeof(booking) = 'object'
       and booking ? 'revision' then
      booking_revision := (booking->>'revision')::integer;
      insert into public.outbox_jobs (workspace_id, kind, dedupe_key, payload)
      values (
        new.workspace_id,
        'google_calendar_sync',
        'google:' || conversation_id || ':' || booking_revision::text,
        jsonb_build_object(
          'conversationId', conversation_id,
          'bookingRevision', booking_revision
        )
      )
      on conflict (workspace_id, kind, dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

create trigger demo_state_enqueue_google_calendar_sync
after update of state on public.demo_state
for each row
execute function public.enqueue_google_calendar_sync_jobs();

create or replace function public.claim_outbox_jobs(
  p_workspace_id text,
  p_limit integer default 10
)
returns setof public.outbox_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.outbox_jobs
    where workspace_id = p_workspace_id
      and (
        (status = 'pending' and available_at <= now())
        or (status = 'running' and locked_at < now() - interval '5 minutes')
      )
    order by available_at asc, id asc
    for update skip locked
    limit greatest(1, least(p_limit, 20))
  )
  update public.outbox_jobs as jobs
  set
    status = 'running',
    attempts = jobs.attempts + 1,
    locked_at = now(),
    updated_at = now(),
    last_error = null
  from candidates
  where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

-- SUPABASE ACCESS START
alter table public.outbox_jobs enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_events enable row level security;

revoke all on table public.outbox_jobs from anon, authenticated;
revoke all on table public.google_calendar_connections from anon, authenticated;
revoke all on table public.google_calendar_events from anon, authenticated;
revoke all on function public.enqueue_outbox_job(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_telegram_auto_reply_job() from public, anon, authenticated;
revoke all on function public.enqueue_google_calendar_sync_jobs() from public, anon, authenticated;
revoke all on function public.claim_outbox_jobs(text, integer) from public, anon, authenticated;

grant select, insert, update, delete on table public.outbox_jobs to service_role;
grant usage on sequence public.outbox_jobs_id_seq to service_role;
grant select, insert, update, delete on table public.google_calendar_connections to service_role;
grant select, insert, update, delete on table public.google_calendar_events to service_role;
grant execute on function public.enqueue_outbox_job(text, text, text, jsonb) to service_role;
grant execute on function public.claim_outbox_jobs(text, integer) to service_role;
-- SUPABASE ACCESS END

commit;
