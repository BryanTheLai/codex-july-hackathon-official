# ElevenLabs autonomy MVP

## Decision

This hackathon app remains the authority for Telegram, the agent loop, booking state, `.ics`
delivery, Eval, and Knowledge. Direct OpenAI supplies text generation and judging. ElevenLabs supplies
only speech-to-text (STT) and text-to-speech (TTS) through its direct HTTP APIs; it does not become
a second agent implementation.

This is deliberately a demo of an autonomous aircon service desk, not a production field-service system.

## Why this is the smallest winning change

```text
Telegram voice note
  -> existing download + ffmpeg WebM conversion
  -> selected STT provider
       OpenAI: whisper-1 + translation endpoint
       ElevenLabs: scribe_v2 + existing text translation service
  -> existing typed agent/tool loop
  -> existing CAS booking + audit messages
  -> existing Telegram text + selected TTS provider
  -> existing Ogg conversion + `.ics` delivery
  -> existing customer timeline and Eval/Knowledge routes
```

The model never receives Telegram credentials or a database client. It only chooses a declared
tool; server code validates its arguments and applies the effect. ElevenLabs has no booking,
calendar, Eval, Knowledge, or Telegram authority.

## Exact provider contract

No SDK is added. Node 22 already provides `fetch`, `FormData`, and `Blob`.

| Concern | Existing contract | ElevenLabs implementation |
| --- | --- | --- |
| STT input | Converted temporary WebM file | `POST /v1/speech-to-text`, multipart file, `model_id=scribe_v2` |
| STT result | language, original transcript, optional English gloss, model | Map `language_code` to the existing display language; use the existing text translation service for a non-English gloss |
| TTS input | short approved customer text plus target language | `POST /v1/text-to-speech/:voice_id/stream` |
| TTS result | audio bytes, model, voice | Preserve existing Ogg conversion, storage, and Telegram `sendVoice` flow |
| Provider errors | timeout versus provider failure | Keep the current generic retry/error handling and never send an empty voice artifact |

`eleven_v3` is the default TTS model. `ELEVENLABS_TTS_MODEL` can override it, and all voice shaping
is deployment configuration rather than dashboard-only state.

## Configuration

```dotenv
# Existing direct OpenAI text/reasoning provider. Leave the base URL empty for OpenAI.
LLM_BASE_URL=
LLM_API_KEY=replace-in-deployment-only
LLM_MODEL=gpt-5.6
LLM_API_MODE=responses
LIVE_AGENT_ENABLED=true

# New direct speech selection.
SPEECH_PROVIDER=elevenlabs
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=replace-in-deployment-only
ELEVENLABS_BASE_URL=https://api.elevenlabs.io/v1
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_TTS_MODEL=eleven_v3
ELEVENLABS_VOICE_ID=replace-with-an-authorized-voice-id

# Optional voice controls. Leave blank to preserve the voice's saved defaults.
ELEVENLABS_TTS_STABILITY=
ELEVENLABS_TTS_SIMILARITY_BOOST=
ELEVENLABS_TTS_STYLE=
ELEVENLABS_TTS_SPEED=
ELEVENLABS_TTS_USE_SPEAKER_BOOST=

LIVE_TELEGRAM_ENABLED=true
```

Direct OpenAI text generation remains the fixed provider for the live demo. Its configured model
must pass the provider smoke below: structured final JSON, function call, function continuation,
and a translation request. Do not switch provider during the demo.

## State and schema impact

No Supabase migration is required. Existing fields are provider-neutral strings:

```text
demo_state JSONB
  conversations[]
    messages[]
    booking? -> calendar UID + sequence
  speechArtifacts[] -> model: string
  evalDatasets[].cases[] -> source.kind = autonomous_feedback

telegram_deliveries
  tts_model: nullable string
  tts_voice: nullable string
calendar_deliveries
  calendar UID + provider receipt
```

The one agent-response addition is an optional `evalCaseId` on an existing action-trace item. It
is derived only from the server tool result, not from model text, and links the trace directly to
the existing `/eval?case=...` route. It does not persist a second copy of the candidate.

## Root cause and deploy checks

The present auto-reply code only starts after all of these are true:

1. Telegram webhook and fixed Supabase workspace are configured.
2. `LIVE_TELEGRAM_ENABLED=true` permits outbound Telegram delivery.
3. `LLM_API_KEY` is present and its provider configuration is valid.
4. `LIVE_AGENT_ENABLED=true` permits live agent work.
5. The persisted Telegram conversation is `live_agent` and is not resolved.

The current status banner proves only inbox synchronization. It cannot prove that 2 through 5
are true. `/healthz` exposes non-secret booleans `telegramAutoReply`, `telegramLiveDelivery`, and
`telegramSpeech`; use those plus logs `telegram_auto_reply_started` or
`telegram_auto_reply_skipped` to identify the real deployment cause. A source-only test cannot
prove a real Telegram receipt without the owner-controlled bot chat.

## Twenty considered approaches

| # | Approach | Decision |
| ---: | --- | --- |
| 1 | Keep all speech on OpenAI | Valid fallback, but loses ElevenLabs sponsor differentiation. |
| 2 | Move all agent logic to ElevenAgents | Reject: duplicates the existing source of truth and tool policy. |
| 3 | Direct ElevenLabs REST calls | **Select:** no SDK, small boundary, full server ownership. |
| 4 | Add ElevenLabs SDK | Reject: one dependency for two small HTTP calls. |
| 5 | Browser calls ElevenLabs directly | Reject: would expose the secret. |
| 6 | Replace the booking loop with ElevenLabs tools | Reject: unnecessary second agent control plane. |
| 7 | Add a narrow Postgres outbox | **Select:** two typed jobs make autonomous replies and optional calendar sync recoverable without Redis or a second service. |
| 8 | Add optional single-admin Google OAuth | **Select:** FreeBusy and event CRUD strengthen live proof while deterministic demo slots remain the fallback; Outlook stays deferred. |
| 9 | Add a full field-service scheduler | Defer: breaks the deterministic demo. |
| 10 | Use ElevenLabs STT without an English gloss | Reject: weakens the multilingual judge moment. |
| 11 | Use the existing generic text translation for the gloss | **Select:** preserves the existing data contract. |
| 12 | Add a translation-specific provider | Reject: third speech/text control plane. |
| 13 | Persist provider-specific voice configuration | Reject: deployment configuration is enough for a demo. |
| 14 | Configure model, voice, and voice settings through environment variables | **Select:** repeatable deploys without dashboard edits. |
| 15 | Hard-code a voice ID | Reject: prevents controlled voice iteration. |
| 16 | Build a new no-slots database state | Reject: the existing typed availability result and trace already express it. |
| 17 | Add a deterministic no-slots recovery instruction and clear trace summary | **Select:** proves judgment with one prompt/tool change. |
| 18 | Create Eval candidates with a regex or a button | Reject: hides semantic agent judgment. |
| 19 | Link the existing feedback tool result to the existing Eval case route | **Select:** visible end-to-end learning loop without new state. |
| 20 | Add a separate feedback dashboard | Defer: duplicates Eval and distracts from the main demo. |

## Implementation and proof matrix

| Change | Proof |
| --- | --- |
| ElevenLabs config parsing | unit tests for defaults, required secret/voice, optional voice settings |
| ElevenLabs STT | mocked multipart request, language mapping, English gloss, empty/error/timeout rejection |
| ElevenLabs TTS | mocked request body, model/voice/settings, audio/error/timeout rejection |
| Correct persisted STT model | inbound service records the selected provider's model before transcription begins |
| No-slots recovery | prompt contract and zero-slot action trace tests |
| Complaint to Eval | tool result carries only a server-derived candidate ID; UI opens that exact case |
| Mobile details | existing 390px and 320px E2E verify one-pane Details -> Close -> thread navigation and no document overflow |
| Regression suite | lint, Vitest, typecheck, production build, and Playwright |

## What I need from the owner

1. Set secrets in the deployment environment, never in chat or source control: an ElevenLabs API
   key with `speech_to_text` and `text_to_speech` permissions, an authorized voice ID, the direct
   OpenAI key, Telegram token, and Supabase service-role key.
2. Keep direct OpenAI text generation. DigitalOcean App Platform may host the service, but
   DigitalOcean Model Inference is out of scope.
3. Send two messages from the owner-controlled Telegram chat after deployment: a booking request
   and a natural-language complaint about the outcome. This is the only way to prove real receipt.

## Demo cadence

| Time | Visible proof |
| --- | --- |
| 0-20 sec | Malay voice note becomes transcript plus English gloss; speech model is identifiable in delivery metadata. |
| 20-40 sec | Agent checks a slot, creates booking, and timeline advances. |
| 40-60 sec | Telegram confirmation plus voice and `.ics` invitation receipt. |
| 60-80 sec | Complaint causes agent tool trace -> exact Eval candidate -> human correction requirement -> Knowledge route. |
| Backup | Fully booked date yields a visible `No slots` action trace and alternative slots, without falsely booking. |

## Explicitly not in scope

- ElevenAgents, voice calls, realtime browser speech, cloning a voice, or a second model agent.
- Outlook OAuth, field-service ERP integration, a new scheduler, or multi-tenant auth.
- A second background-job system; the existing Postgres outbox remains authoritative.
- Claiming a live provider or Telegram result without an owner-controlled smoke.

## Primary references

- ElevenLabs, [Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
  for the multipart Scribe v2 request, detected `language_code`, and optional timestamps.
- ElevenLabs, [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
  for the direct voice endpoint, request-scoped voice settings, language code, and audio response.
- ElevenLabs, [Models](https://elevenlabs.io/docs/overview/models)
  for the `eleven_v3` and `scribe_v2` model identifiers.
