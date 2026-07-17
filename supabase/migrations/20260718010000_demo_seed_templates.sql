begin;

create table public.demo_seed_templates (
  seed_key text primary key,
  schema_version integer not null,
  source_state jsonb not null,
  state jsonb,
  compiled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint demo_seed_templates_seed_key_check
    check (length(btrim(seed_key)) between 1 and 128),
  constraint demo_seed_templates_schema_version_check
    check (schema_version > 0),
  constraint demo_seed_templates_source_state_check
    check (jsonb_typeof(source_state) = 'object'),
  constraint demo_seed_templates_state_check
    check (state is null or jsonb_typeof(state) = 'object')
);

create or replace function public.reset_demo_workspace(
  p_workspace_id text,
  p_seed_key text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.demo_seed_templates%rowtype;
  v_previous_revision bigint;
  v_new_revision bigint;
  v_outbox_removed bigint := 0;
  v_google_events_removed bigint := 0;
  v_calendar_deliveries_removed bigint := 0;
  v_telegram_deliveries_removed bigint := 0;
begin
  if p_confirmation is distinct from 'RESET_DEMO' then
    raise exception 'Invalid confirmation token';
  end if;

  if p_workspace_id is distinct from 'demo' then
    raise exception 'Workspace not allowlisted for reset: %', p_workspace_id;
  end if;

  select *
  into v_template
  from public.demo_seed_templates
  where seed_key = p_seed_key
  for update;

  if not found then
    raise exception 'Seed template not found: %', p_seed_key;
  end if;

  if v_template.state is null then
    raise exception 'Seed template not compiled: %', p_seed_key;
  end if;

  perform 1
  from public.demo_state
  where workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Workspace not found: %', p_workspace_id;
  end if;

  select revision
  into v_previous_revision
  from public.demo_state
  where workspace_id = p_workspace_id;

  select count(*)
  into v_google_events_removed
  from public.google_calendar_events
  where workspace_id = p_workspace_id;

  delete from public.google_calendar_events
  where workspace_id = p_workspace_id;

  delete from public.calendar_deliveries
  where workspace_id = p_workspace_id;
  get diagnostics v_calendar_deliveries_removed = row_count;

  delete from public.telegram_deliveries
  where workspace_id = p_workspace_id
    and status in ('pending', 'sending', 'failed');
  get diagnostics v_telegram_deliveries_removed = row_count;

  v_new_revision := v_previous_revision + 1;

  update public.demo_state
  set
    state = v_template.state,
    schema_version = v_template.schema_version,
    revision = v_new_revision,
    updated_at = now()
  where workspace_id = p_workspace_id;

  delete from public.outbox_jobs
  where workspace_id = p_workspace_id;
  get diagnostics v_outbox_removed = row_count;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'seed_key', p_seed_key,
    'previous_revision', v_previous_revision,
    'new_revision', v_new_revision,
    'google_events_removed', v_google_events_removed,
    'outbox_rows_removed', v_outbox_removed,
    'calendar_deliveries_removed', v_calendar_deliveries_removed,
    'telegram_deliveries_removed', v_telegram_deliveries_removed,
    'oauth_preserved', true,
    'telegram_sent_audit_preserved', true,
    'status', 'ready'
  );
end;
$$;

-- SUPABASE ACCESS START
alter table public.demo_seed_templates enable row level security;

revoke all on table public.demo_seed_templates from anon, authenticated;
revoke all on function public.reset_demo_workspace(text, text, text) from public, anon, authenticated;

grant select, insert, update, delete on table public.demo_seed_templates to service_role;
grant execute on function public.reset_demo_workspace(text, text, text) to service_role;
-- SUPABASE ACCESS END

commit;
