begin;

alter table public.telegram_deliveries
  drop constraint if exists telegram_deliveries_voice_tts_metadata_check;

alter table public.telegram_deliveries
  add constraint telegram_deliveries_voice_tts_metadata_check
    check (
      voice_source is distinct from 'tts'
      or (
        tts_model is null
        and tts_voice is null
        and audio_object_path is null
      )
      or (
        tts_model is not null
        and tts_voice is not null
        and audio_object_path is not null
      )
    );

commit;
