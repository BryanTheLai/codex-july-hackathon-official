begin;

-- Validate separately so the schema rollout does not hold the initial table
-- change's exclusive lock while PostgreSQL scans historic Telegram events.
alter table public.telegram_events
  validate constraint telegram_events_normalized_event_check;

commit;
