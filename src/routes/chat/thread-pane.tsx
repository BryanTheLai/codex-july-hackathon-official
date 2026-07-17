import {
  Bot,
  ChevronLeft,
  Languages,
  Lock,
  MessageSquare,
  Mic,
  PanelRight,
  Send,
  Sparkles,
  User,
  UserRound,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router";

import {
  translateFixtureReply,
  type AgentMode,
  type Conversation,
  type Message,
  type MutationResult,
} from "../../domain";
import type { AgentRunResult } from "../../contracts/agent";
import type { GenerateAgentDraftResult } from "../../store/agent-slice";
import type { SendVisitorReplyInput } from "../../store/telegram-slice";
import { ConfirmAction } from "./confirm-action";
import { formatFullTimestamp } from "./chat-model";

type MessageSide = "incoming" | "outgoing" | "system";

function messageSide(message: Message): MessageSide {
  if (message.role === "patient") {
    return "incoming";
  }
  if (message.role === "staff" || message.role === "synthetic_agent") {
    return "outgoing";
  }
  return "system";
}

function roleLabel(message: Message): string {
  if (message.role === "patient") {
    return "Customer";
  }
  if (message.role === "staff") {
    return "Staff";
  }
  if (message.role === "synthetic_agent") {
    return "Autonomous agent";
  }
  if (message.role === "system" && message.text.startsWith("Internal note:")) {
    return "Internal note";
  }
  return "System audit";
}

function RoleIcon({ message, size = 12 }: { message: Message; size?: number }) {
  if (message.role === "patient") {
    return <User aria-hidden="true" size={size} />;
  }
  if (message.role === "staff") {
    return <UserRound aria-hidden="true" size={size} />;
  }
  if (message.role === "synthetic_agent") {
    return <Sparkles aria-hidden="true" size={size} />;
  }
  return <Lock aria-hidden="true" size={size} />;
}

type TranslationLanguage = "English" | "Malay" | "Mandarin";

type SpeechArtifactView = {
  status: "pending" | "transcribing" | "ready" | "failed";
  error: string | null;
};

type LiveTranslationPreview = {
  sourceText: string;
  targetLanguage: TranslationLanguage;
  text: string;
  approved: boolean;
};

function preferredTranslationLanguage(language: string): TranslationLanguage {
  if (language === "Malay" || language === "Mandarin") {
    return language;
  }
  return "English";
}

function MessageRow({
  message,
  channel,
  speechArtifact,
  onRetrySpeech,
  onSaveManualTranscript,
}: {
  message: Conversation["messages"][number];
  channel: string;
  speechArtifact?: SpeechArtifactView;
  onRetrySpeech?: (
    messageId: string,
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
  onSaveManualTranscript?: (
    messageId: string,
    input: {
      detectedLanguage: string;
      englishGloss?: string | null;
      originalTranscript: string;
    },
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
}) {
  const internal = message.role === "system" && message.text.startsWith("Internal note:");
  const side = messageSide(message);

  return (
    <article
      className={[
        "message-row",
        `message-row--${side}`,
        internal ? "message-row--internal" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-message-side={side}
    >
      {side === "incoming" ? (
        <span aria-hidden="true" className="message-avatar message-avatar--incoming">
          <RoleIcon message={message} size={15} />
        </span>
      ) : null}
      <div className="message-bubble">
        <header className="message-bubble__meta">
          <span className="message-bubble__role">
            <span>{roleLabel(message)}</span>
          </span>
          {channel === "Voice transcript" && message.role === "patient" ? (
            <span
              aria-label="Voice transcript"
              className="message-bubble__channel"
              role="img"
              title="Voice transcript"
            >
              <Mic aria-hidden="true" size={13} />
            </span>
          ) : null}
          {message.role === "synthetic_agent" ? (
            <span className="chat-badge chat-badge--info">Demo simulation</span>
          ) : null}
          <time dateTime={message.sentAt}>{formatFullTimestamp(message.sentAt)}</time>
        </header>
        <div className="message-bubble__text" data-message-side={side}>
          {message.text}
        </div>
        {message.gloss ? (
          <div className="message-bubble__gloss">
            <strong>English translation</strong>
            <span>{message.gloss}</span>
          </div>
        ) : null}
        {speechArtifact ? (
          <SpeechMessageControls
            artifact={speechArtifact}
            message={message}
            onRetrySpeech={onRetrySpeech}
            onSaveManualTranscript={onSaveManualTranscript}
          />
        ) : null}
        {message.outboundVoice ? <OutboundVoiceMessageControls message={message} /> : null}
        {message.role === "synthetic_agent" ? (
          <span className="message-bubble__boundary">No external contact. Synthetic output only.</span>
        ) : null}
      </div>
      {side === "outgoing" ? (
        <span aria-hidden="true" className="message-avatar message-avatar--outgoing">
          <RoleIcon message={message} size={15} />
        </span>
      ) : null}
    </article>
  );
}

function channelTone(channel: string): "telegram" | "whatsapp" | "neutral" {
  if (channel === "Telegram") {
    return "telegram";
  }
  if (channel === "WhatsApp") {
    return "whatsapp";
  }
  return "neutral";
}

function channelIcon(channel: string) {
  if (channel === "Voice transcript") {
    return <Mic aria-hidden="true" size={14} />;
  }
  if (channel === "WhatsApp" || channel === "SMS") {
    return <MessageSquare aria-hidden="true" size={14} />;
  }
  return <MessageSquare aria-hidden="true" size={14} />;
}

function HandlerBadge({
  mode,
  live,
}: {
  mode: AgentMode;
  live: boolean;
}) {
  const autonomous = mode === "synthetic_agent";
  const label = autonomous
    ? live
      ? "Telegram inbox: autonomous agent can reply and manage bookings"
      : "Autonomous agent handling"
    : live
      ? "Telegram inbox: autopilot paused for staff-only replies"
      : "Staff only handling";
  if (live && autonomous) {
    return (
      <span
        aria-label={label}
        className="thread-header__autopilot"
        role="img"
        title="Telegram automation is managed by the server."
      >
        <Bot aria-hidden="true" size={14} />
        <span aria-hidden="true">Autopilot</span>
      </span>
    );
  }
  return (
    <span
      aria-label={label}
      className={`thread-header__handler thread-header__handler--${autonomous ? "synthetic" : "staff"}`}
      role="img"
      title={label}
    >
      {autonomous ? <Bot aria-hidden="true" size={14} /> : <UserRound aria-hidden="true" size={14} />}
    </span>
  );
}

function Composer({
  conversation,
  onGenerateDraft,
  onSend,
  onTranslate,
}: {
  conversation: Conversation;
  onGenerateDraft: (
    conversationId: string,
    signal?: AbortSignal,
  ) => Promise<GenerateAgentDraftResult>;
  onSend: (
    input: SendVisitorReplyInput,
    signal?: AbortSignal,
  ) => MutationResult | Promise<MutationResult>;
  onTranslate?: (
    text: string,
    targetLanguage: string,
    signal?: AbortSignal,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}) {
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const agentControllerRef = useRef<AbortController | null>(null);
  const sendControllerRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const generationRef = useRef(0);
  const [kind, setKind] = useState<SendVisitorReplyInput["kind"]>("reply");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRunResult | null>(
    null,
  );
  const [agentStatus, setAgentStatus] = useState<
    "idle" | "running" | "ready" | "failed"
  >("idle");
  const [isSending, setIsSending] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [liveTranslation, setLiveTranslation] = useState<LiveTranslationPreview | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<"text" | "voice" | "both">("text");
  const [recording, setRecording] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<"idle" | "recording">("idle");
  const [voiceSource, setVoiceSource] = useState<"tts" | "recorded">("tts");
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>(
    preferredTranslationLanguage(conversation.patient.preferredLanguage),
  );
  const resolved = conversation.workflowStatus === "resolved";
  const liveTelegram = conversation.channel === "Telegram";
  const empty = draft.trim().length === 0;
  const isGenerating = agentStatus === "running";
  const generationBlocked =
    resolved ||
    conversation.agentMode === "staff_only" ||
    isGenerating ||
    isSending;
  const translation =
    !liveTelegram && autoTranslate && kind === "reply" && !empty
      ? translateFixtureReply(draft, translationLanguage)
      : null;
  const translationBlocked = translation?.ok === false;
  const liveTranslationBlocked = liveTelegram && liveTranslation !== null && !liveTranslation.approved;

  useEffect(() => {
    generationRef.current += 1;
    sendControllerRef.current?.abort();
    sendControllerRef.current = null;
    sendInFlightRef.current = false;
    setKind("reply");
    setDraft("");
    setError("");
    setAgentError("");
    setAgentRun(null);
    setAgentStatus("idle");
    setIsSending(false);
    setIsTranslating(false);
    setLiveTranslation(null);
    setAutoTranslate(false);
    setDeliveryMode("text");
    setVoiceSource("tts");
    setRecording(null);
    setRecordingStatus("idle");
    setTranslationLanguage(preferredTranslationLanguage(conversation.patient.preferredLanguage));
    requestRef.current = null;
    return () => {
      generationRef.current += 1;
      agentControllerRef.current?.abort();
      agentControllerRef.current = null;
      sendControllerRef.current?.abort();
      sendControllerRef.current = null;
      sendInFlightRef.current = false;
      recorderRef.current?.stop();
      recorderRef.current = null;
    };
  }, [conversation.id]);

  useEffect(() => {
    if (!recording) {
      setRecordingUrl(null);
      return;
    }
    const url = URL.createObjectURL(recording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  const generate = async () => {
    if (generationBlocked) {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setAgentError("");
    setError("");
    setAgentRun(null);
    setAgentStatus("running");
    const controller = new AbortController();
    agentControllerRef.current = controller;
    let result: GenerateAgentDraftResult;
    try {
      result = await onGenerateDraft(
        conversation.id,
        controller.signal,
      );
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      setAgentError("The agent draft could not be generated.");
      setAgentStatus("failed");
      return;
    } finally {
      if (agentControllerRef.current === controller) {
        agentControllerRef.current = null;
      }
    }
    if (generationRef.current !== generation) {
      return;
    }
    if (!result.ok) {
      setAgentError(result.error);
      setAgentStatus("failed");
      return;
    }
    setKind("reply");
    setDraft(result.result.draft.patientText);
    setLiveTranslation(null);
    setAutoTranslate(false);
    setAgentRun(result.result);
    setAgentStatus("ready");
    requestRef.current = null;
  };

  const translateLiveReply = async () => {
    if (!liveTelegram || !onTranslate || empty || isTranslating || isSending) {
      return;
    }
    setIsTranslating(true);
    setError("");
    try {
      const result = await onTranslate(draft, translationLanguage);
      if (result.ok) {
        setLiveTranslation({
          sourceText: draft,
          targetLanguage: translationLanguage,
          text: result.text,
          approved: false,
        });
        requestRef.current = null;
      } else {
        setError(result.error);
      }
    } finally {
      setIsTranslating(false);
    }
  };

  const toggleRecording = async () => {
    if (recordingStatus === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record a staff voice reply.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setRecordingStatus("idle");
        const completed = new Blob(chunks, { type: mimeType });
        if (completed.size > 0) {
          setRecording(completed);
          requestRef.current = null;
        } else {
          setError("No audio was captured. Record the staff reply again.");
        }
      };
      recorderRef.current = recorder;
      setRecording(null);
      setError("");
      setRecordingStatus("recording");
      recorder.start();
    } catch {
      setError("Microphone access was not granted. Use Text or TTS instead.");
    }
  };

  const submit = async () => {
    if (
      resolved ||
      empty ||
      isSending ||
      sendInFlightRef.current ||
      isGenerating ||
      translationBlocked ||
      liveTranslationBlocked ||
      isTranslating ||
      (liveTelegram && kind === "reply" && deliveryMode !== "text" &&
        voiceSource === "recorded" && !recording)
    ) {
      return;
    }
    const controller = new AbortController();
    sendControllerRef.current?.abort();
    sendControllerRef.current = controller;
    sendInFlightRef.current = true;
    setIsSending(true);
    setError("");
    const requestKey = JSON.stringify({
      conversationId: conversation.id,
      kind,
      text: draft,
      translation,
      liveTranslation,
      deliveryMode,
      voiceSource,
      recordingSize: recording?.size ?? null,
    });
    const requestId =
      requestRef.current?.key === requestKey
        ? requestRef.current.id
        : crypto.randomUUID();
    requestRef.current = { key: requestKey, id: requestId };
    try {
      const result = await onSend(
        {
          requestId,
          conversationId: conversation.id,
          kind,
          text: draft,
          translation: liveTranslation?.approved
            ? {
                language: liveTranslation.targetLanguage,
                text: liveTranslation.text,
              }
            : translation?.ok === true && translation.language !== "English"
              ? {
                  language: translation.language,
                  text: translation.text,
                }
              : undefined,
          deliveryMode: liveTelegram && kind === "reply" ? deliveryMode : "text",
          voiceRecording:
            liveTelegram && kind === "reply" && voiceSource === "recorded"
              ? recording ?? undefined
              : undefined,
          voiceSource:
            liveTelegram && kind === "reply" && deliveryMode !== "text"
              ? voiceSource
              : undefined,
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        requestRef.current = null;
        setDraft("");
        setLiveTranslation(null);
        setKind("reply");
        setAgentError("");
        setAgentRun(null);
        setAgentStatus("idle");
      } else {
        setError(result.error);
      }
    } catch (caught) {
      if (
        !controller.signal.aborted &&
        !(caught instanceof DOMException && caught.name === "AbortError")
      ) {
        setError("The message could not be sent. Try again.");
      }
    } finally {
      if (sendControllerRef.current === controller) {
        sendControllerRef.current = null;
        sendInFlightRef.current = false;
        setIsSending(false);
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  const blockedReason = resolved
    ? "Conversation resolved. Reopen it to send."
    : empty
      ? "Enter a message before sending."
    : translation?.ok === false
      ? translation.error
      : liveTranslationBlocked
        ? `Approve the ${liveTranslation.targetLanguage} preview before sending.`
      : liveTelegram && kind === "reply" && deliveryMode !== "text" &&
          voiceSource === "recorded" && !recording
        ? "Record a staff voice reply before sending."
        : "";

  return (
    <section aria-label="Message composer" className="chat-composer">
      <div aria-label="Composer mode" className="chat-composer__tabs" role="group">
        <button
          aria-pressed={kind === "reply"}
          onClick={() => setKind("reply")}
          type="button"
        >
          Customer reply
        </button>
        <button
          aria-pressed={kind === "internal_note"}
          onClick={() => setKind("internal_note")}
          type="button"
        >
          Internal note
        </button>
        {kind === "reply" && !liveTelegram ? (
          <>
            <button
              aria-pressed={autoTranslate}
              className="chat-composer__translate-toggle"
              onClick={() => setAutoTranslate((current) => !current)}
              type="button"
            >
              <Languages aria-hidden="true" size={14} />
              <span>Auto-translate</span>
            </button>
            {autoTranslate ? (
              <label className="chat-composer__language">
                <span className="visually-hidden">Translation language</span>
                <select
                  aria-label="Translation language"
                  onChange={(event) =>
                    setTranslationLanguage(event.target.value as TranslationLanguage)
                  }
                  value={translationLanguage}
                >
                  <option value="English">English</option>
                  <option value="Malay">Malay</option>
                  <option value="Mandarin">Mandarin</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        <span
          aria-live="polite"
          className={`chat-composer__agent-status chat-composer__agent-status--${agentStatus}`}
        >
          {liveTelegram ? (
            <>
              <Bot aria-hidden="true" size={14} />
              Telegram autopilot
            </>
          ) : (
            <>Agent {agentStatus}</>
          )}
        </span>
        <button
          className={`chat-composer__generate${liveTelegram ? " chat-composer__generate--server-managed" : ""}`}
          disabled={generationBlocked}
          onClick={() => {
            void generate();
          }}
          title={
            resolved
              ? "Reopen the conversation before generating a draft."
              : conversation.agentMode === "staff_only"
                ? "Turn on agent handling before generating a draft."
                : undefined
          }
          type="button"
        >
          <Sparkles aria-hidden="true" size={14} />
          {isGenerating ? "Generating draft" : "Generate draft"}
        </button>
      </div>
      {kind === "reply" && liveTelegram ? (
        <details className="chat-composer__delivery-options">
          <summary aria-label="Open manual delivery options">
            <strong>Open manual delivery options</strong>
            <span>Translate, choose text or voice, then send</span>
          </summary>
          <div className="chat-composer__live-controls">
            <label className="chat-composer__language">
              <span>Translate to</span>
              <select
                aria-label="Translation language"
                onChange={(event) => {
                  setTranslationLanguage(event.target.value as TranslationLanguage);
                  setLiveTranslation(null);
                }}
                value={translationLanguage}
              >
                <option value="English">English</option>
                <option value="Malay">Malay</option>
                <option value="Mandarin">Mandarin</option>
              </select>
            </label>
            <button
              className="chat-composer__translate-toggle"
              disabled={empty || isSending || isTranslating || !onTranslate}
              onClick={() => void translateLiveReply()}
              type="button"
            >
              <Languages aria-hidden="true" size={14} />
              {isTranslating ? "Translating" : "Translate"}
            </button>
            <label className="chat-composer__language">
              <span>Deliver</span>
              <select
                aria-label="Telegram delivery mode"
                onChange={(event) =>
                  setDeliveryMode(event.target.value as "text" | "voice" | "both")
                }
                value={deliveryMode}
              >
                <option value="text">Text</option>
                <option value="voice">Voice</option>
                <option value="both">Text + voice</option>
              </select>
            </label>
            {deliveryMode !== "text" ? (
              <>
                <label className="chat-composer__language">
                  <span>Voice source</span>
                  <select
                    aria-label="Telegram voice source"
                    onChange={(event) =>
                      setVoiceSource(event.target.value as "tts" | "recorded")
                    }
                    value={voiceSource}
                  >
                    <option value="tts">AI TTS</option>
                    <option value="recorded">Staff recording</option>
                  </select>
                </label>
                {voiceSource === "recorded" ? (
                  <>
                    <button
                      className="chat-composer__record"
                      onClick={() => void toggleRecording()}
                      type="button"
                    >
                      <Mic aria-hidden="true" size={14} />
                      {recordingStatus === "recording"
                        ? "Stop recording"
                        : "Record staff voice"}
                    </button>
                    {recordingUrl ? <audio controls src={recordingUrl} /> : null}
                  </>
                ) : (
                  <span className="chat-composer__voice-disclosure">AI-generated voice from the approved preview</span>
                )}
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      {liveTranslation ? (
        <section aria-label="Translated delivery preview" className="chat-composer__translation-preview">
          <div>
            <strong>{liveTranslation.targetLanguage} delivery preview</strong>
            <span>{liveTranslation.approved ? "Approved for delivery" : "Review before delivery"}</span>
          </div>
          <p>{liveTranslation.text}</p>
          {!liveTranslation.approved ? (
            <button
              className="chat-button chat-button--primary"
              onClick={() => setLiveTranslation((current) => current ? { ...current, approved: true } : current)}
              type="button"
            >
              Use {liveTranslation.targetLanguage} preview for delivery
            </button>
          ) : null}
          {deliveryMode !== "text" && voiceSource === "tts" ? (
            <span className="chat-composer__voice-disclosure">
              Voice will synthesize this exact approved preview.
            </span>
          ) : null}
        </section>
      ) : null}
      {agentRun ? (
        <section
          aria-label="Agent draft review"
          className="chat-composer__agent-review"
        >
          <div className="chat-composer__agent-review-header">
            <strong>English agent response</strong>
            <span className="chat-badge chat-badge--info">
              {agentRun.draft.patientLanguage}
            </span>
          </div>
          <p>{agentRun.draft.englishText}</p>
          <div className="chat-composer__evidence">
            <strong>Playbook evidence</strong>
            {agentRun.evidence.length > 0 ? (
              <ul>
                {agentRun.evidence.map((evidence) => (
                  <li
                    key={`${evidence.fileId}:${evidence.versionId}:${evidence.contentHash}`}
                  >
                    {evidence.excerpt}
                  </li>
                ))}
              </ul>
            ) : (
              <span>No playbook evidence returned.</span>
            )}
          </div>
          {agentRun.toolCalls.length > 0 ? (
            <div className="chat-composer__evidence">
              <strong>Autonomous action trace</strong>
              <ul>
                {agentRun.toolCalls.map((call) => (
                  <li key={call.callId}>
                    {call.status === "completed" ? "Completed" : "Blocked"}: {call.summary}
                    {call.evalCaseId ? (
                      <Link className="chat-text-button" to={`/eval?case=${encodeURIComponent(call.evalCaseId)}`}>
                        Open Eval candidate
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {translation ? (
        <div
          aria-label="Translation preview"
          className={`chat-composer__translation-preview${
            translation.ok ? "" : " chat-composer__translation-preview--error"
          }`}
          role="status"
        >
          {translation.ok ? translation.text : translation.error}
        </div>
      ) : null}
      <div className="chat-composer__body">
        <textarea
          aria-describedby="composer-help"
          aria-label="Message"
          disabled={resolved || isSending || isGenerating}
          onChange={(event) => {
            setDraft(event.target.value);
            setLiveTranslation(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            kind === "reply"
              ? liveTelegram
                ? `Enter the final ${conversation.patient.preferredLanguage} Telegram reply...`
                : "Write a staff reply..."
              : "Add a note visible only inside this demo..."
          }
          value={draft}
        />
        <button
          className="chat-composer__send"
          disabled={
            resolved ||
            empty ||
            isSending ||
            isGenerating ||
            translationBlocked ||
            liveTranslationBlocked ||
            isTranslating ||
            (liveTelegram && kind === "reply" && deliveryMode !== "text" &&
              voiceSource === "recorded" && !recording)
          }
          onClick={() => {
            void submit();
          }}
          type="button"
        >
          <Send aria-hidden="true" size={16} />
          {isSending ? "Sending" : kind === "reply" ? "Send" : "Add note"}
        </button>
      </div>
      <div aria-live="polite" className="chat-composer__help" id="composer-help">
        {agentError ||
          error ||
          blockedReason ||
          "Press Command or Control + Enter to send."}
      </div>
    </section>
  );
}

function OutboundVoiceMessageControls({
  message,
}: {
  message: Conversation["messages"][number];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
  const source = message.outboundVoice?.source === "recorded" ? "Staff recording" : "AI-generated";
  const play = async () => {
    if (!audioRef.current) {
      setError("Sent voice playback is not ready. Try again in a moment.");
      return;
    }
    try {
      await audioRef.current.play();
    } catch {
      setError("Sent voice playback failed. The Telegram delivery remains recorded as sent.");
    }
  };
  if (!message.outboundVoice) {
    return null;
  }
  return (
    <section aria-label="Sent voice controls" className="message-voice-controls">
      <div className="message-voice-controls__status">
        <Mic aria-hidden="true" size={13} />
        <span>
          {source} voice sent{message.language ? ` in ${message.language}` : ""}
        </span>
      </div>
      {message.outboundVoice.spokenTextHash ? (
        <span className="message-voice-controls__receipt">
          Approved script checksum {message.outboundVoice.spokenTextHash.slice(0, 12)}
        </span>
      ) : null}
      <button onClick={() => void play()} type="button">Play sent voice</button>
      <audio
        controls
        onError={() => setError("Sent voice playback failed. The Telegram delivery remains recorded as sent.")}
        preload="none"
        ref={audioRef}
        src={`/api/outbound/deliveries/${encodeURIComponent(message.outboundVoice.deliveryId)}/voice/audio`}
      >
        Sent voice playback is not available in this browser.
      </audio>
      {error ? <span className="message-voice-controls__error">{error}</span> : null}
    </section>
  );
}

function SpeechMessageControls({
  artifact,
  message,
  onRetrySpeech,
  onSaveManualTranscript,
}: {
  artifact: SpeechArtifactView;
  message: Conversation["messages"][number];
  onRetrySpeech?: (
    messageId: string,
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
  onSaveManualTranscript?: (
    messageId: string,
    input: {
      detectedLanguage: string;
      englishGloss?: string | null;
      originalTranscript: string;
    },
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [transcript, setTranscript] = useState(
    message.text.startsWith("Voice note awaiting") ? "" : message.text,
  );
  const [language, setLanguage] = useState(message.language || "Malay");
  const [gloss, setGloss] = useState(message.gloss ?? "");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const retry = async () => {
    if (!onRetrySpeech || isWorking) {
      return;
    }
    setIsWorking(true);
    setError("");
    const result = await onRetrySpeech(message.id);
    if (!result.ok) {
      setError(result.error);
    }
    setIsWorking(false);
  };
  const play = async () => {
    if (!audioRef.current) {
      setError("Voice playback is not ready. Try again in a moment.");
      return;
    }
    try {
      await audioRef.current.play();
    } catch {
      setError("Voice playback failed. Retry transcription or enter a manual transcript.");
    }
  };
  const saveManual = async () => {
    if (!onSaveManualTranscript || !transcript.trim() || !language.trim() || isWorking) {
      return;
    }
    setIsWorking(true);
    setError("");
    const result = await onSaveManualTranscript(message.id, {
      detectedLanguage: language,
      originalTranscript: transcript,
      englishGloss: gloss.trim() || null,
    });
    if (!result.ok) {
      setError(result.error);
    } else {
      setManualOpen(false);
    }
    setIsWorking(false);
  };
  return (
    <section aria-label="Voice message controls" className="message-voice-controls">
      <div className="message-voice-controls__status">
        <Mic aria-hidden="true" size={13} />
        <span>Voice {artifact.status}</span>
      </div>
      <button onClick={() => void play()} type="button">Play voice</button>
      <audio
        controls
        onError={() => setError("Voice playback failed. Retry transcription or enter a manual transcript.")}
        preload="none"
        ref={audioRef}
        src={`/api/telegram/speech/${encodeURIComponent(message.id)}/audio`}
      >
        Voice playback is not available in this browser.
      </audio>
      {artifact.status === "failed" && onRetrySpeech ? (
        <button disabled={isWorking} onClick={() => void retry()} type="button">
          {isWorking ? "Retrying" : "Retry transcription"}
        </button>
      ) : null}
      {onSaveManualTranscript ? (
        <button
          aria-expanded={manualOpen}
          onClick={() => setManualOpen((current) => !current)}
          type="button"
        >
          Manual transcript
        </button>
      ) : null}
      {artifact.error ? <span className="message-voice-controls__error">{artifact.error}</span> : null}
      {manualOpen ? (
        <div className="message-voice-controls__manual">
          <label>
            <span>Original language</span>
            <input onChange={(event) => setLanguage(event.target.value)} value={language} />
          </label>
          <label>
            <span>Transcript</span>
            <textarea onChange={(event) => setTranscript(event.target.value)} value={transcript} />
          </label>
          <label>
            <span>English gloss (optional)</span>
            <textarea onChange={(event) => setGloss(event.target.value)} value={gloss} />
          </label>
          <button disabled={isWorking || !transcript.trim()} onClick={() => void saveManual()} type="button">
            Save transcript
          </button>
        </div>
      ) : null}
      {error ? <span className="message-voice-controls__error">{error}</span> : null}
    </section>
  );
}

export function ThreadPane({
  conversation,
  feedbackEvalCaseId = null,
  showBack,
  showDetails,
  onBack,
  onDetails,
  onGenerateDraft,
  onReopen,
  onResolve,
  onSend,
  onSetAgentMode,
  onRetrySpeech,
  onSaveManualTranscript,
  onTranslate,
  speechArtifacts = {},
}: {
  conversation?: Conversation;
  feedbackEvalCaseId?: string | null;
  showBack: boolean;
  showDetails: boolean;
  onBack: () => void;
  onDetails: () => void;
  onGenerateDraft: (
    conversationId: string,
    signal?: AbortSignal,
  ) => Promise<GenerateAgentDraftResult>;
  onReopen: (conversationId: string) => MutationResult;
  onResolve: (conversationId: string) => MutationResult;
  onSend: (
    input: SendVisitorReplyInput,
    signal?: AbortSignal,
  ) => MutationResult | Promise<MutationResult>;
  onSetAgentMode: (
    conversationId: string,
    mode: AgentMode,
  ) => MutationResult | Promise<MutationResult>;
  onRetrySpeech?: (
    messageId: string,
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
  onSaveManualTranscript?: (
    messageId: string,
    input: {
      detectedLanguage: string;
      englishGloss?: string | null;
      originalTranscript: string;
    },
    signal?: AbortSignal,
  ) => Promise<MutationResult>;
  onTranslate?: (
    text: string,
    targetLanguage: string,
    signal?: AbortSignal,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  speechArtifacts?: Record<string, SpeechArtifactView>;
}) {
  if (!conversation) {
    return (
      <section aria-label="Selected conversation" className="chat-pane thread-pane" role="region">
        <div className="chat-empty chat-empty--center">
          <strong>Select a conversation</strong>
          <span>Choose a visible queue row to open the thread.</span>
        </div>
      </section>
    );
  }

  const resolved = conversation.workflowStatus === "resolved";
  const liveTelegram = conversation.channel === "Telegram";

  return (
    <section aria-label="Selected conversation" className="chat-pane thread-pane" role="region">
      <header className="thread-header">
        {showBack ? (
          <button
            aria-label="Back to queue"
            className="chat-icon-button"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
        ) : null}
        <div className="thread-header__identity">
          <strong>{conversation.patient.name}</strong>
          <span className="thread-header__channel">
            <span
              className={`thread-header__channel-name thread-header__channel-name--${channelTone(conversation.channel)}`}
            >
              {channelIcon(conversation.channel)}
              {conversation.channel}
            </span>
            <span className="thread-header__channel-meta">
              | {conversation.patient.preferredLanguage} |{" "}
              {conversation.urgency === "emergency" ? "Emergency" : "Routine"}
            </span>
          </span>
        </div>
        <HandlerBadge
          live={conversation.channel === "Telegram"}
          mode={conversation.agentMode}
        />
        <span className="thread-header__date">{formatFullTimestamp(conversation.messages[0]!.sentAt)}</span>
        <label className="thread-header__mode">
          <span className="visually-hidden">
            {liveTelegram ? "Telegram autopilot setting" : "Agent mode"}
          </span>
          <select
            aria-label={liveTelegram ? "Telegram autopilot setting" : "Agent mode"}
            disabled={resolved}
            onChange={(event) => {
              void onSetAgentMode(
                conversation.id,
                event.target.value as AgentMode,
              );
            }}
            title={
              liveTelegram
                ? "Agent handling enables Telegram autopilot. Staff only pauses it."
                : "Choose whether the agent or staff handles this conversation."
            }
            value={conversation.agentMode}
          >
            <option value="synthetic_agent">Agent handling</option>
            <option value="staff_only">Staff only</option>
          </select>
        </label>
        {resolved ? (
          <button
            className="chat-button"
            onClick={() => onReopen(conversation.id)}
            type="button"
          >
            Reopen
          </button>
        ) : (
          <ConfirmAction
            confirmLabel="Resolve conversation"
            description="This moves this conversation to Done and disables the composer. You can reopen it later."
            onConfirm={() => {
              onResolve(conversation.id);
            }}
            title={`Resolve ${conversation.patient.name}?`}
            trigger={
              <button className="chat-button" type="button">
                Resolve
              </button>
            }
          />
        )}
        {showDetails ? (
          <button
            aria-label="Details"
            className="chat-button thread-header__details"
            onClick={onDetails}
            type="button"
          >
            <PanelRight aria-hidden="true" size={16} />
            <span>Details</span>
          </button>
        ) : null}
      </header>

      <div aria-label="Conversation messages" className="thread-messages" tabIndex={0}>
        <div className="thread-transcript">
          {conversation.messages.map((message) => (
            <MessageRow
              channel={conversation.channel}
              key={message.id}
              message={message}
              onRetrySpeech={onRetrySpeech}
              onSaveManualTranscript={onSaveManualTranscript}
              speechArtifact={speechArtifacts[message.id]}
            />
          ))}
        </div>
      </div>

      {feedbackEvalCaseId ? (
        <section aria-label="Learning signal" className="chat-learning-banner">
          <strong>Learning signal captured</strong>
          <p>The agent flagged this conversation for review. Shared SOPs have not changed.</p>
          <Link className="chat-text-button" to={`/eval?case=${encodeURIComponent(feedbackEvalCaseId)}`}>
            Open Eval case
          </Link>
        </section>
      ) : null}

      <Composer
        conversation={conversation}
        key={conversation.id}
        onGenerateDraft={onGenerateDraft}
        onSend={onSend}
        onTranslate={onTranslate}
      />
    </section>
  );
}
