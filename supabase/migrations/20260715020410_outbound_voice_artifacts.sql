begin;

alter table public.telegram_deliveries
  add column voice_source text,
  add column audio_object_path text,
  add column audio_content_type text,
  add column audio_sha256 text,
  add column tts_model text,
  add column tts_voice text,
  add constraint telegram_deliveries_voice_source_check
    check (voice_source is null or voice_source in ('tts', 'recorded')),
  add constraint telegram_deliveries_audio_content_type_check
    check (audio_content_type is null or audio_content_type = 'audio/ogg'),
  add constraint telegram_deliveries_audio_metadata_check
    check (
      (audio_object_path is null and audio_content_type is null and audio_sha256 is null)
      or
      (audio_object_path is not null and audio_content_type = 'audio/ogg' and audio_sha256 is not null)
    ),
  add constraint telegram_deliveries_voice_source_part_check
    check (part = 'voice' or voice_source is null),
  add constraint telegram_deliveries_voice_tts_metadata_check
    check (
      voice_source <> 'tts'
      or (tts_model is not null and tts_voice is not null)
    );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'voice-artifacts',
  'voice-artifacts',
  false,
  52428800,
  array['audio/ogg']
)
on conflict (id) do nothing;

commit;
