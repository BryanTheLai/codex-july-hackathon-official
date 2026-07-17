import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useMediaQuery } from "../../app/use-media-query";
import type {
  AgentMode,
  ConversationId,
  PatientUpdateInput,
  SimulateScenario,
  UpdateBookingInput,
} from "../../domain";
import { useAppStore } from "../../store/app-store-context";
import {
  type ChatFilter,
  type ChatView,
  type MobilePane,
  visibleConversations,
} from "./chat-model";
import { BookingDialog } from "./booking-dialog";
import { ChatToolbar } from "./chat-toolbar";
import { PatientRail } from "./patient-rail";
import { QueuePane } from "./queue-pane";
import { SchedulePane } from "./schedule-pane";
import { SimulateDialog } from "./simulate-dialog";
import { ThreadPane } from "./thread-pane";
import "./chat.css";

export default function ChatRoute() {
  const routeRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const state = useAppStore((store) => store.state);
  const selectConversation = useAppStore((store) => store.selectConversation);
  const selectPlaybookFile = useAppStore((store) => store.selectPlaybookFile);
  const generateAgentDraft = useAppStore(
    (store) => store.generateAgentDraft,
  );
  const sendVisitorReply = useAppStore((store) => store.sendVisitorReply);
  const sendCalendarInvitation = useAppStore(
    (store) => store.sendCalendarInvitation,
  );
  const retryTelegramDelivery = useAppStore(
    (store) => store.retryTelegramDelivery,
  );
  const refreshTelegramWorkspace = useAppStore(
    (store) => store.refreshTelegramWorkspace,
  );
  const reconcileTelegramDelivery = useAppStore(
    (store) => store.reconcileTelegramDelivery,
  );
  const retryTelegramSpeech = useAppStore((store) => store.retryTelegramSpeech);
  const saveTelegramManualTranscript = useAppStore(
    (store) => store.saveTelegramManualTranscript,
  );
  const translateTelegramReply = useAppStore(
    (store) => store.translateTelegramReply,
  );
  const telegramWorkspaceStatus = useAppStore(
    (store) => store.telegramWorkspace.status,
  );
  const pendingTelegramDelivery = useAppStore(
    (store) => store.telegramWorkspace.pendingDelivery,
  );
  const telegramDeliveryNotice = useAppStore(
    (store) => store.telegramWorkspace.deliveryNotice,
  );
  const telegramWorkspaceRevision = useAppStore(
    (store) => store.telegramWorkspace.workspaceRevision,
  );
  const telegramSpeechArtifacts = useAppStore(
    (store) => store.telegramWorkspace.speechArtifacts,
  );
  const resolveConversation = useAppStore((store) => store.resolveConversation);
  const reopenConversation = useAppStore((store) => store.reopenConversation);
  const updatePatient = useAppStore((store) => store.updatePatient);
  const cancelBooking = useAppStore((store) => store.cancelBooking);
  const updateBooking = useAppStore((store) => store.updateBooking);
  const escalateEmergency = useAppStore((store) => store.escalateEmergency);
  const addLabel = useAppStore((store) => store.addLabel);
  const removeLabel = useAppStore((store) => store.removeLabel);
  const resetSyntheticConversation = useAppStore(
    (store) => store.resetSyntheticConversation,
  );
  const setAgentMode = useAppStore((store) => store.setAgentMode);
  const simulatePatient = useAppStore((store) => store.simulatePatient);
  const playbookIdForConversation = useAppStore(
    (store) => store.playbookIdForConversation,
  );
  const resetVersion = useAppStore((store) => store.resetVersion);
  const rememberedMobilePane = useAppStore((store) => store.routeUi.chatMobilePane);
  const updateRouteUi = useAppStore((store) => store.updateRouteUi);

  const isMobile = useMediaQuery("(max-width: 759px)");
  const viewportUsesRailDrawer = useMediaQuery("(max-width: 1099px)");
  const usesWideQueue = useMediaQuery("(min-width: 900px)");
  const [containerTooNarrow, setContainerTooNarrow] = useState(false);
  const [view, setView] = useState<ChatView>("inbox");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [mobilePane, setMobilePane] = useState<MobilePane>(rememberedMobilePane);
  const [railOpen, setRailOpen] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [bookingEditId, setBookingEditId] = useState<ConversationId | null>(null);
  const isSinglePane = isMobile || containerTooNarrow;
  const usesRailDrawer = !isSinglePane && viewportUsesRailDrawer;

  useEffect(() => {
    const controller = new AbortController();
    void refreshTelegramWorkspace(controller.signal).catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [refreshTelegramWorkspace]);

  useEffect(() => {
    if (telegramWorkspaceStatus !== "ready") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshTelegramWorkspace().catch(() => undefined);
    }, 8_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshTelegramWorkspace, telegramWorkspaceStatus]);

  useEffect(() => {
    updateRouteUi({ chatMobilePane: mobilePane });
  }, [mobilePane, updateRouteUi]);

  useEffect(() => {
    if (resetVersion === 0) {
      return;
    }
    setView("inbox");
    setQuery("");
    setFilter("all");
    setMobilePane("list");
    setRailOpen(false);
    setSimulateOpen(false);
    setBookingEditId(null);
  }, [resetVersion]);

  useLayoutEffect(() => {
    const route = routeRef.current;
    if (!route) {
      return;
    }
    const update = () => {
      const width = route.getBoundingClientRect().width;
      const minimum = usesWideQueue ? 760 : 720;
      setContainerTooNarrow(width > 0 && width < minimum);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(route);
    return () => {
      observer.disconnect();
    };
  }, [usesWideQueue]);

  const visible = useMemo(
    () => visibleConversations(state.conversations, query, filter),
    [filter, query, state.conversations],
  );
  const selectedConversation =
    visible.find((conversation) => conversation.id === state.selections.conversationId) ??
    visible[0];
  const visibleIds = visible.map((conversation) => conversation.id).join("|");
  const failedSpeechConversationId = useMemo(
    () =>
      state.conversations.find((conversation) =>
        conversation.messages.some(
          (message) => telegramSpeechArtifacts[message.id]?.status === "failed",
        ),
      )?.id ?? null,
    [state.conversations, telegramSpeechArtifacts],
  );
  const failedDelivery = telegramDeliveryNotice?.status === "partial_failure" ||
    telegramDeliveryNotice?.status === "failed";
  const needsAttention =
    failedDelivery ||
    pendingTelegramDelivery !== null ||
    failedSpeechConversationId !== null;
  const connectionStatus = telegramWorkspaceStatus === "error"
    ? "offline"
    : needsAttention || telegramWorkspaceRevision === null
      ? "attention"
      : "connected";
  const connectionLabel = connectionStatus === "connected"
    ? "Connected"
    : connectionStatus === "offline"
      ? "Offline"
      : "Attention needed";
  const deliveryStatusLabel = telegramDeliveryNotice?.status === "partial_failure"
    ? "Partial failure"
    : telegramDeliveryNotice?.status === "failed"
      ? "Failed"
      : telegramDeliveryNotice?.status === "voice_sent"
        ? "Voice sent"
        : telegramDeliveryNotice?.status === "sent"
          ? "Sent"
          : telegramDeliveryNotice?.status === "sending"
            ? "Sending"
            : null;
  const statusDetail = telegramWorkspaceStatus === "error"
    ? "Inbox refresh failed. Staff actions are paused until it reconnects."
    : failedDelivery
      ? `${deliveryStatusLabel}: ${telegramDeliveryNotice.message}`
      : pendingTelegramDelivery
        ? "A Telegram message was accepted and is waiting for inbox synchronization. Do not resend it."
        : failedSpeechConversationId
          ? "A voice transcription needs staff attention."
          : telegramDeliveryNotice
            ? `${deliveryStatusLabel}: ${telegramDeliveryNotice.message}`
            : telegramWorkspaceRevision === null
              ? "Waiting for the first successful Telegram inbox refresh."
              : "Inbox synchronization is healthy.";
  const issueConversationId = failedDelivery
    ? telegramDeliveryNotice.conversationId
    : failedSpeechConversationId;
  const retryLabel = telegramDeliveryNotice?.failedParts.length
    ? `Retry failed ${telegramDeliveryNotice.failedParts.join(" and ")}`
    : "Retry original delivery";

  useEffect(() => {
    if (
      selectedConversation &&
      selectedConversation.id !== state.selections.conversationId
    ) {
      selectConversation(selectedConversation.id);
      return;
    }
    if (!selectedConversation && state.selections.conversationId !== null) {
      selectConversation(null);
    }
  }, [
    selectConversation,
    selectedConversation,
    state.selections.conversationId,
    visibleIds,
  ]);

  const openConversation = (conversationId: ConversationId) => {
    selectConversation(conversationId);
    setView("inbox");
    setRailOpen(false);
    if (isSinglePane) {
      setMobilePane("thread");
    }
  };

  const openEval = () => {
    if (!selectedConversation) {
      return {
        ok: false as const,
        state,
        error: "Conversation not found",
      };
    }
    navigate(`/eval?import=${selectedConversation.id}`);
    return { ok: true as const, state };
  };

  const openDream = () => {
    if (!selectedConversation) {
      return;
    }
    const playbookId = playbookIdForConversation(selectedConversation.id);
    if (!playbookId) {
      return;
    }
    selectPlaybookFile(playbookId);
    navigate(`/dream?file=${playbookId}`);
  };

  const renderRail = (showClose: boolean) =>
    selectedConversation ? (
      <PatientRail
        conversation={selectedConversation}
        onAddLabel={(label) => addLabel(selectedConversation.id, label)}
        onCancelBooking={() => cancelBooking(selectedConversation.id)}
        onClose={() => {
          setRailOpen(false);
          setMobilePane("thread");
        }}
        onDream={openDream}
        onEditBooking={() => setBookingEditId(selectedConversation.id)}
        onEscalate={() => escalateEmergency(selectedConversation.id)}
        onImportEval={openEval}
        onRemoveLabel={(label) => removeLabel(selectedConversation.id, label)}
        onResetSyntheticConversation={() =>
          resetSyntheticConversation(selectedConversation.id)
        }
        onUpdatePatient={(input: PatientUpdateInput) =>
          updatePatient(selectedConversation.id, input)
        }
        showClose={showClose}
      />
    ) : null;

  const renderThread = () => (
    <ThreadPane
      conversation={selectedConversation}
      onBack={() => setMobilePane("list")}
      onDetails={() => {
        if (isSinglePane) {
          setMobilePane("details");
        } else {
          setRailOpen(true);
        }
      }}
      onGenerateDraft={(conversationId, signal) =>
        generateAgentDraft(conversationId, signal)
      }
      onReopen={(conversationId) => reopenConversation(conversationId)}
      onResolve={(conversationId) => resolveConversation(conversationId)}
      onSend={(input, signal) => sendVisitorReply(input, signal)}
      onTranslate={(text, targetLanguage, signal) =>
        translateTelegramReply(text, targetLanguage, signal)
      }
      onRetrySpeech={(messageId, signal) => retryTelegramSpeech(messageId, signal)}
      onSaveManualTranscript={(messageId, input, signal) =>
        saveTelegramManualTranscript(messageId, input, signal)
      }
      onSetAgentMode={(conversationId, mode: AgentMode) =>
        setAgentMode({ conversationId, mode })
      }
      showBack={isSinglePane}
      showDetails={isSinglePane || usesRailDrawer}
      speechArtifacts={telegramSpeechArtifacts}
    />
  );

  const inbox = isSinglePane ? (
    mobilePane === "list" ? (
      <QueuePane
        conversations={visible}
        onSelect={openConversation}
        selectedId={selectedConversation?.id ?? null}
      />
    ) : mobilePane === "thread" ? (
      renderThread()
    ) : (
      renderRail(true)
    )
  ) : (
    <>
      <QueuePane
        conversations={visible}
        onSelect={openConversation}
        selectedId={selectedConversation?.id ?? null}
      />
      {renderThread()}
      {!usesRailDrawer ? renderRail(false) : null}
      {usesRailDrawer && railOpen ? (
        <div className="patient-rail-drawer">{renderRail(true)}</div>
      ) : null}
    </>
  );

  return (
    <section
      aria-labelledby="chat-route-title"
      className={`route-root chat-route${isSinglePane ? " chat-route--single" : ""}`}
      ref={routeRef}
    >
      <ChatToolbar
        count={visible.length}
        filter={filter}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRefresh={() => {
          if (pendingTelegramDelivery) {
            void reconcileTelegramDelivery();
            return;
          }
          void refreshTelegramWorkspace();
        }}
        onSimulate={() => setSimulateOpen(true)}
        onViewChange={(nextView) => {
          setView(nextView);
          if (nextView === "inbox" && isSinglePane) {
            setMobilePane("list");
          }
        }}
        query={query}
        refreshing={telegramWorkspaceStatus === "loading"}
        syncPending={pendingTelegramDelivery !== null}
        view={view}
      />
      <section
        aria-label="Telegram connection and delivery status"
        aria-live="polite"
        className={`telegram-status-banner telegram-status-banner--${connectionStatus}`}
        role="status"
      >
        <span className="telegram-status-banner__indicator" />
        <div className="telegram-status-banner__copy">
          <strong>{connectionLabel}</strong>
          <span>{statusDetail}</span>
        </div>
        {issueConversationId ? (
          <button
            className="chat-text-button"
            onClick={() => openConversation(issueConversationId)}
            type="button"
          >
            Open affected conversation
          </button>
        ) : null}
        {failedDelivery && telegramDeliveryNotice ? (
          <button
            className="chat-button"
            onClick={() => void retryTelegramDelivery()}
            type="button"
          >
            {retryLabel}
          </button>
        ) : null}
      </section>
      <div aria-label="Chat workbench" className={`chat-workbench chat-workbench--${view}`}>
        {view === "schedule" ? (
          <SchedulePane
            compact={isSinglePane}
            conversations={state.conversations}
            fixtureTime={state.fixtureTime}
            onEditBooking={setBookingEditId}
            onOpenConversation={openConversation}
            onSendCalendar={(conversationId) =>
              void sendCalendarInvitation(conversationId)
            }
          />
        ) : (
          inbox
        )}
      </div>
      <SimulateDialog
        onOpenChange={setSimulateOpen}
        onSimulate={(scenario: SimulateScenario) => {
          const result = simulatePatient(scenario);
          if (result.ok) {
            setFilter("all");
            setQuery("");
            setView("inbox");
            setMobilePane(isSinglePane ? "thread" : "list");
          }
          return result;
        }}
        open={simulateOpen}
      />
      <BookingDialog
        conversation={
          state.conversations.find((conversation) => conversation.id === bookingEditId) ?? null
        }
        onOpenChange={(open) => {
          if (!open) {
            setBookingEditId(null);
          }
        }}
        onSave={(input: UpdateBookingInput) =>
          bookingEditId
            ? updateBooking(bookingEditId, input)
            : {
                error: "Booking not found",
                ok: false as const,
                state,
              }
        }
        open={bookingEditId !== null}
      />
    </section>
  );
}
