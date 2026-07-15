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
    return "Patient";
  }
  if (message.role === "staff") {
    return "Staff";
  }
  if (message.role === "synthetic_agent") {
    return "Synthetic agent";
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

function preferredTranslationLanguage(language: string): TranslationLanguage {
  if (language === "Malay" || language === "Mandarin") {
    return language;
  }
  return "English";
}

function MessageRow({
  message,
  channel,
}: {
  message: Conversation["messages"][number];
  channel: string;
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
            <span className="chat-badge chat-badge--info">Synthetic Demo</span>
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
  const synthetic = !live && mode === "synthetic_agent";
  const label = live
    ? "Live Telegram handling"
    : synthetic
      ? "Synthetic agent handling"
      : "Staff only handling";
  return (
    <span
      aria-label={label}
      className={`thread-header__handler thread-header__handler--${synthetic ? "synthetic" : "staff"}`}
      role="img"
      title={label}
    >
      {synthetic ? <Bot aria-hidden="true" size={14} /> : <UserRound aria-hidden="true" size={14} />}
    </span>
  );
}

function Composer({
  conversation,
  onGenerateDraft,
  onSend,
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
}) {
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const agentControllerRef = useRef<AbortController | null>(null);
  const sendControllerRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
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
    setAutoTranslate(false);
    setTranslationLanguage(preferredTranslationLanguage(conversation.patient.preferredLanguage));
    requestRef.current = null;
    return () => {
      generationRef.current += 1;
      agentControllerRef.current?.abort();
      agentControllerRef.current = null;
      sendControllerRef.current?.abort();
      sendControllerRef.current = null;
      sendInFlightRef.current = false;
    };
  }, [conversation.id]);

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
    setAutoTranslate(false);
    setAgentRun(result.result);
    setAgentStatus("ready");
    requestRef.current = null;
  };

  const submit = async () => {
    if (
      resolved ||
      empty ||
      isSending ||
      sendInFlightRef.current ||
      isGenerating ||
      translationBlocked
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
          translation:
            translation?.ok === true && translation.language !== "English"
              ? {
                  language: translation.language,
                  text: translation.text,
                }
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
      : "";

  return (
    <section aria-label="Message composer" className="chat-composer">
      <div aria-label="Composer mode" className="chat-composer__tabs" role="group">
        <button
          aria-pressed={kind === "reply"}
          onClick={() => setKind("reply")}
          type="button"
        >
          Patient reply
        </button>
        <button
          aria-pressed={kind === "internal_note"}
          onClick={() => setKind("internal_note")}
          type="button"
        >
          Internal note
        </button>
        <span
          aria-live="polite"
          className={`chat-composer__agent-status chat-composer__agent-status--${agentStatus}`}
        >
          Agent {agentStatus}
        </span>
        <button
          className="chat-composer__generate"
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
      {agentRun ? (
        <section
          aria-label="Agent draft review"
          className="chat-composer__agent-review"
        >
          <div className="chat-composer__agent-review-header">
            <strong>English draft</strong>
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
        </section>
      ) : null}
      {kind === "reply" && liveTelegram ? (
        <div className="chat-composer__translation">
          <span>
            Live Telegram: enter the final {conversation.patient.preferredLanguage} text.
          </span>
        </div>
      ) : kind === "reply" ? (
        <div className="chat-composer__translation">
          <button
            aria-pressed={autoTranslate}
            aria-label="Auto-translate"
            onClick={() => setAutoTranslate((current) => !current)}
            type="button"
          >
            <Languages aria-hidden="true" size={14} />
                <span>Auto-translate</span>
          </button>
          <label>
            <span className="visually-hidden">Translation language</span>
            <select
              aria-label="Translation language"
              disabled={!autoTranslate}
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
          <span>{autoTranslate ? `Sends in ${translationLanguage}` : "Patient language"}</span>
        </div>
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
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            kind === "reply"
              ? "Write a staff reply..."
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
            translationBlocked
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

export function ThreadPane({
  conversation,
  showBack,
  showDetails,
  onBack,
  onDetails,
  onGenerateDraft,
  onReopen,
  onResolve,
  onSend,
  onSetAgentMode,
}: {
  conversation?: Conversation;
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
  onSetAgentMode: (conversationId: string, mode: AgentMode) => MutationResult;
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
            {channelIcon(conversation.channel)}
            {conversation.channel} | {conversation.patient.preferredLanguage} |{" "}
            {conversation.urgency === "emergency" ? "Emergency" : "Routine"}
          </span>
        </div>
        <HandlerBadge
          live={conversation.channel === "Telegram"}
          mode={conversation.agentMode}
        />
        <span className="thread-header__date">{formatFullTimestamp(conversation.messages[0]!.sentAt)}</span>
        <label className="thread-header__mode">
          <span className="visually-hidden">Agent mode</span>
          <select
            aria-label="Agent mode"
            disabled={resolved}
            onChange={(event) =>
              onSetAgentMode(conversation.id, event.target.value as AgentMode)
            }
            value={conversation.agentMode}
          >
            <option value="synthetic_agent">Synthetic agent on</option>
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
            <MessageRow channel={conversation.channel} key={message.id} message={message} />
          ))}
        </div>
      </div>

      <Composer
        conversation={conversation}
        key={conversation.id}
        onGenerateDraft={onGenerateDraft}
        onSend={onSend}
      />
    </section>
  );
}
