begin;

drop function if exists public.reset_demo_workspace(text, text, text);

create or replace function public.reset_demo_workspace(
  p_workspace_id text,
  p_seed_key text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_template public.demo_seed_templates%rowtype;
  v_workspace public.demo_state%rowtype;
  v_outbox_removed bigint := 0;
  v_google_events_removed bigint := 0;
  v_calendar_deliveries_removed bigint := 0;
  v_telegram_deliveries_removed bigint := 0;
  v_telegram_events_removed bigint := 0;
  v_new_revision bigint;
begin
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

  if p_workspace_id is distinct from 'demo' then
    raise exception 'Workspace not allowlisted for reset: %', p_workspace_id;
  end if;

  select *
  into v_workspace
  from public.demo_state
  where workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Workspace not found: %', p_workspace_id;
  end if;

  if v_workspace.revision <> p_expected_revision then
    raise exception 'revision_conflict';
  end if;

  delete from public.outbox_jobs where workspace_id = p_workspace_id;
  get diagnostics v_outbox_removed = row_count;

  delete from public.google_calendar_events where workspace_id = p_workspace_id;
  get diagnostics v_google_events_removed = row_count;

  delete from public.calendar_deliveries where workspace_id = p_workspace_id;
  get diagnostics v_calendar_deliveries_removed = row_count;

  delete from public.telegram_deliveries where workspace_id = p_workspace_id;
  get diagnostics v_telegram_deliveries_removed = row_count;

  delete from public.telegram_events where workspace_id = p_workspace_id;
  get diagnostics v_telegram_events_removed = row_count;

  v_new_revision := v_workspace.revision + 1;

  update public.demo_state
  set state = v_template.state,
    schema_version = v_template.schema_version,
    revision = revision + 1,
    updated_at = now()
  where workspace_id = p_workspace_id;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'seed_key', p_seed_key,
    'previous_revision', v_workspace.revision,
    'new_revision', v_new_revision,
    'outbox_rows_removed', v_outbox_removed,
    'google_events_removed', v_google_events_removed,
    'calendar_deliveries_removed', v_calendar_deliveries_removed,
    'telegram_deliveries_removed', v_telegram_deliveries_removed,
    'telegram_events_removed', v_telegram_events_removed,
    'oauth_preserved', true
  );
end;
$$;

-- SUPABASE ACCESS START
revoke all on function public.reset_demo_workspace(text, text, bigint) from public, anon, authenticated;

grant execute on function public.reset_demo_workspace(text, text, bigint) to service_role;
-- SUPABASE ACCESS END

commit;
