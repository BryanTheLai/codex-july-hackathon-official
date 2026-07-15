import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRunResult } from "../../src/contracts/agent";
import type {
  AgentClient,
  TelegramOutboundClient,
  WorkspaceClient,
} from "../../src/services/api-client";
import { ApiClientError } from "../../src/services/api-client";
import {
  createCanonicalServerState,
  linkAcceptedTelegramOutboundText,
  mergeTelegramInboundText,
} from "../../src/domain";
import ChatRoute from "../../src/routes/chat/chat-route";
import { AppStoreProvider } from "../../src/store/app-store-context";
import { createAppStore, type AppStore } from "../../src/store/use-app-store";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function installMatchMedia(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("759px") ? width <= 759 : query.includes("1099px") && width <= 1099,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function renderChat(options: { width?: number; store?: AppStore } = {}) {
  installMatchMedia(options.width ?? 1440);
  const store = options.store ?? createAppStore(new MemoryStorage());
  const result = render(
    <AppStoreProvider store={store}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatRoute />} />
          <Route path="/eval" element={<div>Evaluation Lab destination</div>} />
          <Route path="/dream" element={<div>Dream destination</div>} />
        </Routes>
      </MemoryRouter>
    </AppStoreProvider>,
  );

  return { ...result, store };
}

async function telegramServerState() {
  const result = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: {
      externalId: "42",
      displayName: "Aina Zulkifli",
    },
    message: {
      kind: "text",
      text: "Boleh saya buat temujanji?",
      language: "ms",
    },
    receivedAt: "2026-07-13T12:00:00.000Z",
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.state;
}

describe("Chat Control route", () => {
  beforeEach(() => {
    installMatchMedia(1440);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a queue, selected conversation, and patient context instead of a dashboard", () => {
    renderChat();

    expect(screen.getByRole("heading", { name: "Chat Control" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Conversation queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Patient context" })).toBeInTheDocument();
    expect(screen.getByText("Emergency")).toBeInTheDocument();
    expect(screen.getAllByText("Ahmad bin Hassan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Synthetic Demo").length).toBeGreaterThan(0);
    expect(screen.queryByText(/overview|welcome back|total conversations/i)).not.toBeInTheDocument();
  });

  it("renders real message sides, centered audit rows, and explicit handler identity", async () => {
    const user = userEvent.setup();
    renderChat();

    const selected = screen.getByRole("region", { name: "Selected conversation" });
    expect(within(selected).getByText("I have chest pain and sweating since this morning.")).toHaveAttribute(
      "data-message-side",
      "incoming",
    );
    expect(
      within(selected).getByText(
        "Please seek urgent care now. This demo did not contact emergency services.",
      ),
    ).toHaveAttribute("data-message-side", "outgoing");
    expect(within(selected).getByText("Synthetic agent")).toBeInTheDocument();
    expect(within(selected).getByLabelText("Synthetic agent handling")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open conversation with Rajesh Kumar" }));
    expect(within(selected).getByText("Conversation resolved by staff.")).toHaveAttribute(
      "data-message-side",
      "system",
    );
    expect(within(selected).getByLabelText("Staff only handling")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open conversation with Mei Lin Tan" }));
    expect(within(selected).getByText("我想续开降压药。")).toBeInTheDocument();
    expect(within(selected).getByLabelText("Voice transcript")).toBeInTheDocument();
    expect(within(selected).queryByText("Transcript")).not.toBeInTheDocument();
  });

  it("shows clear English translations and previews auto-translated staff replies", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Open conversation with Nurul Aisyah" }));
    const selected = screen.getByRole("region", { name: "Selected conversation" });
    expect(within(selected).getAllByText("English translation")).toHaveLength(2);
    expect(
      within(selected).getByText("I would like to make an appointment with Dr. Siti Rahman."),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText("We will check your slot and send confirmation."),
    ).toBeInTheDocument();

    const autoTranslate = within(selected).getByRole("button", { name: "Auto-translate" });
    expect(autoTranslate).toHaveAttribute("aria-pressed", "false");
    await user.click(autoTranslate);
    expect(within(selected).getByRole("combobox", { name: "Translation language" })).toHaveValue(
      "Malay",
    );
    await user.type(
      within(selected).getByRole("textbox", { name: "Message" }),
      "Please bring your identity card fifteen minutes before arrival.",
    );
    expect(within(selected).getByRole("status", { name: "Translation preview" })).toHaveTextContent(
      "Sila bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
    );
    await user.click(within(selected).getByRole("button", { name: "Send" }));

    expect(
      within(selected).getByText(
        "Sila bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
      ),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText(
        "Please bring your identity card fifteen minutes before arrival.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks unsupported synthetic translations without sending fake text", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Open conversation with Nurul Aisyah" }));
    const selected = screen.getByRole("region", { name: "Selected conversation" });
    await user.click(within(selected).getByRole("button", { name: "Auto-translate" }));
    await user.type(within(selected).getByRole("textbox", { name: "Message" }), "Unsupported phrase");

    expect(within(selected).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(selected).toHaveTextContent("Synthetic translation is unavailable for this phrase.");
  });

  it("prefills a reviewable agent draft without appending or sending it", async () => {
    const serverState = await createCanonicalServerState();
    const conversation = serverState.conversations[0];
    if (!conversation) {
      throw new Error("Canonical state is missing a conversation");
    }
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 4,
        state: serverState,
      }),
    };
    const agentClient: AgentClient = {
      run: vi.fn().mockResolvedValue({
        runId: "agent-run-1",
        draft: {
          englishText: "Please seek urgent care now.",
          patientLanguage: "Malay",
          patientText: "Sila dapatkan rawatan kecemasan sekarang.",
        },
        proposedAction: "reply",
        handoffReason: null,
        evidence: [
          {
            fileId: "triage",
            versionId: "dream-v1",
            contentHash: "hash-triage",
            excerpt: "Escalate urgent symptoms.",
          },
        ],
        toolCalls: [],
        stopReason: "completed",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
        latencyMs: 250,
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      reconcile: vi.fn(),
      send: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      agentClient,
      outboundClient,
      workspaceClient,
    });
    const beforeMessages =
      store.getState().state.conversations[0]?.messages.length;
    const user = userEvent.setup();
    renderChat({ store });
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });

    await user.click(
      within(selected).getByRole("button", {
        name: "Generate draft",
      }),
    );

    expect(
      await within(selected).findByText("Agent ready"),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText("Please seek urgent care now."),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText("Escalate urgent symptoms."),
    ).toBeInTheDocument();
    expect(
      within(selected).getByText("Malay", { selector: ".chat-badge" }),
    ).toBeInTheDocument();
    expect(
      within(selected).getByRole("textbox", { name: "Message" }),
    ).toHaveValue("Sila dapatkan rawatan kecemasan sekarang.");
    expect(
      store.getState().state.conversations[0]?.messages.length,
    ).toBe(beforeMessages);
    expect(outboundClient.send).not.toHaveBeenCalled();
    expect(agentClient.run).toHaveBeenCalledWith(
      {
        kind: "manual",
        conversationId: conversation.id,
        expectedConversationRevision: conversation.revision,
      },
      expect.any(AbortSignal),
    );
  });

  it("keeps manual composer text when agent generation fails", async () => {
    const serverState = await createCanonicalServerState();
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 4,
        state: serverState,
      }),
    };
    const agentClient: AgentClient = {
      run: vi.fn().mockRejectedValue(
        new ApiClientError(
          "provider_timeout",
          "The agent request timed out.",
          true,
        ),
      ),
    };
    const store = createAppStore(new MemoryStorage(), {
      agentClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    const message = within(selected).getByRole("textbox", {
      name: "Message",
    });
    await user.type(message, "Keep this manual draft.");

    await user.click(
      within(selected).getByRole("button", {
        name: "Generate draft",
      }),
    );

    expect(
      await within(selected).findByText("Agent failed"),
    ).toBeInTheDocument();
    expect(selected).toHaveTextContent("The agent request timed out.");
    expect(message).toHaveValue("Keep this manual draft.");
  });

  it("aborts an in-flight draft when the visitor switches conversations", async () => {
    const serverState = await createCanonicalServerState();
    let runSignal: AbortSignal | undefined;
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 4,
        state: serverState,
      }),
    };
    const agentClient: AgentClient = {
      run: vi.fn(
        (_request, signal) =>
          new Promise<AgentRunResult>((_resolve, reject) => {
            runSignal = signal;
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    };
    const store = createAppStore(new MemoryStorage(), {
      agentClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    await user.click(
      within(selected).getByRole("button", {
        name: "Generate draft",
      }),
    );
    await vi.waitFor(() => {
      expect(agentClient.run).toHaveBeenCalledTimes(1);
    });

    await user.click(
      screen.getByRole("button", {
        name: "Open conversation with Nurul Aisyah",
      }),
    );

    await vi.waitFor(() => {
      expect(runSignal?.aborted).toBe(true);
    });
    const nextSelected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    expect(nextSelected).toHaveTextContent("Nurul Aisyah");
    expect(within(nextSelected).getByText("Agent idle")).toBeInTheDocument();
    expect(
      within(nextSelected).queryByText(
        "Please seek urgent care now.",
      ),
    ).not.toBeInTheDocument();
  });

  it("loads real Telegram text into Chat on entry without replacing synthetic threads", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: await telegramServerState(),
      }),
    };
    const store = createAppStore(new MemoryStorage(), { workspaceClient });
    const user = userEvent.setup();
    renderChat({ store });

    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    expect(selected).toHaveTextContent("Boleh saya buat temujanji?");
    expect(selected).toHaveTextContent("Telegram");
    expect(
      within(selected).queryByRole("button", { name: "Auto-translate" }),
    ).not.toBeInTheDocument();
    expect(
      within(selected).getByLabelText("Live Telegram handling"),
    ).toBeInTheDocument();
    expect(
      within(selected).getByRole("button", { name: "Generate draft" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Open conversation with Ahmad bin Hassan",
      }),
    ).toBeInTheDocument();
  });

  it("sends exact visitor-approved Telegram text then refreshes provider-linked state", async () => {
    const inbound = await telegramServerState();
    const linked = linkAcceptedTelegramOutboundText(inbound, {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:01:00.000Z",
    });
    if (!linked.ok) {
      throw new Error(linked.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: linked.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });

    await user.type(
      within(selected).getByRole("textbox", { name: "Message" }),
      "Klinik akan menghubungi anda.",
    );
    await user.click(within(selected).getByRole("button", { name: "Send" }));

    expect(
      await within(selected).findByText("Klinik akan menghubungi anda."),
    ).toHaveAttribute("data-message-side", "outgoing");
    expect(outboundClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
        conversationId: "telegram-conversation:-10042",
        expectedConversationRevision: 1,
        targetLanguage: "Malay",
        approvedPatientText: "Klinik akan menghubungi anda.",
        mode: "text",
      }),
      expect.any(AbortSignal),
    );
  });

  it("offers no-resend reconciliation when accepted text is missing after refresh", async () => {
    const inbound = await telegramServerState();
    const linked = linkAcceptedTelegramOutboundText(inbound, {
      conversationId: "telegram-conversation:-10042",
      messageId: "telegram-delivery:send-42:text",
      text: "Klinik akan menghubungi anda.",
      language: "Malay",
      sentAt: "2026-07-13T12:01:00.000Z",
    });
    if (!linked.ok) {
      throw new Error(linked.error);
    }
    const workspaceClient: WorkspaceClient = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 1,
          state: inbound,
        })
        .mockResolvedValueOnce({
          workspaceId: "demo",
          revision: 2,
          state: linked.state,
        }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "sent",
        text: {
          providerMessageId: "9001",
          acceptedAt: "2026-07-13T12:01:00.000Z",
        },
      }),
      reconcile: vi.fn().mockResolvedValue({
        deliveryId: "send-42",
        workspaceSyncStatus: "synced",
        workspaceRevision: 2,
      }),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    await user.type(
      within(selected).getByRole("textbox", { name: "Message" }),
      "Klinik akan menghubungi anda.",
    );
    await user.click(within(selected).getByRole("button", { name: "Send" }));

    const sync = await screen.findByRole("button", {
      name: "Sync accepted Telegram message",
    });
    await user.click(sync);

    expect(
      await within(selected).findByText("Klinik akan menghubungi anda."),
    ).toHaveAttribute("data-message-side", "outgoing");
    expect(outboundClient.send).toHaveBeenCalledTimes(1);
    expect(outboundClient.reconcile).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Refresh Telegram inbox" }),
    ).toBeInTheDocument();
  });

  it("keeps a failed Telegram draft and reuses its request ID", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: await telegramServerState(),
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn().mockResolvedValue({
        deliveryIds: ["send-42"],
        status: "failed",
      }),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    await user.click(
      screen.getByRole("button", { name: "Refresh Telegram inbox" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    const message = within(selected).getByRole("textbox", {
      name: "Message",
    });
    await user.type(message, "Cuba lagi.");

    await user.click(within(selected).getByRole("button", { name: "Send" }));
    await within(selected).findByText(/Telegram did not accept/i);
    await user.click(within(selected).getByRole("button", { name: "Send" }));

    expect(message).toHaveValue("Cuba lagi.");
    expect(outboundClient.send).toHaveBeenCalledTimes(2);
    const firstRequest = vi.mocked(outboundClient.send).mock.calls[0]![0];
    const secondRequest = vi.mocked(outboundClient.send).mock.calls[1]![0];
    expect(secondRequest.requestId).toBe(firstRequest.requestId);
    expect(
      within(selected).queryByText("Cuba lagi.", {
        selector: '[data-message-side="outgoing"]',
      }),
    ).not.toBeInTheDocument();
  });

  it("allows only one Telegram send before React disables the button", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: await telegramServerState(),
      }),
    };
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn(
        (_request, signal) =>
          new Promise<never>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    await user.click(
      screen.getByRole("button", { name: "Refresh Telegram inbox" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    const selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    await user.type(
      within(selected).getByRole("textbox", { name: "Message" }),
      "Send once.",
    );
    const send = within(selected).getByRole("button", { name: "Send" });

    fireEvent.click(send);
    fireEvent.click(send);

    await vi.waitFor(() => {
      expect(outboundClient.send).toHaveBeenCalledTimes(1);
    });
  });

  it("aborts an in-flight Telegram send when the visitor switches conversations", async () => {
    const workspaceClient: WorkspaceClient = {
      load: vi.fn().mockResolvedValue({
        workspaceId: "demo",
        revision: 1,
        state: await telegramServerState(),
      }),
    };
    let sendSignal: AbortSignal | undefined;
    const outboundClient: TelegramOutboundClient = {
      send: vi.fn(
        (_request, signal) =>
          new Promise<never>((_resolve, reject) => {
            sendSignal = signal;
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
      reconcile: vi.fn(),
    };
    const store = createAppStore(new MemoryStorage(), {
      outboundClient,
      workspaceClient,
    });
    const user = userEvent.setup();
    renderChat({ store });
    await user.click(
      screen.getByRole("button", { name: "Refresh Telegram inbox" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Open conversation with Aina Zulkifli",
      }),
    );
    let selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    await user.type(
      within(selected).getByRole("textbox", { name: "Message" }),
      "Slow send.",
    );
    await user.click(within(selected).getByRole("button", { name: "Send" }));
    await vi.waitFor(() => {
      expect(outboundClient.send).toHaveBeenCalledTimes(1);
    });

    await user.click(
      screen.getByRole("button", {
        name: "Open conversation with Ahmad bin Hassan",
      }),
    );

    await vi.waitFor(() => {
      expect(sendSignal?.aborted).toBe(true);
    });
    selected = screen.getByRole("region", {
      name: "Selected conversation",
    });
    const nextDraft = within(selected).getByRole("textbox", {
      name: "Message",
    });
    await user.type(nextDraft, "Keep this draft.");
    expect(nextDraft).toHaveValue("Keep this draft.");
    expect(selected).not.toHaveTextContent("The Telegram send request failed.");
  });

  it("collapses queue groups without hiding the selected thread", async () => {
    const user = userEvent.setup();
    renderChat();

    const emergency = screen.getByRole("button", { name: "Emergency, 1 conversation" });
    expect(emergency).toHaveAttribute("aria-expanded", "true");
    await user.click(emergency);

    expect(emergency).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Open conversation with Ahmad bin Hassan" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Ahmad bin Hassan",
    );
  });

  it("searches and filters the queue without leaving stale patient content", async () => {
    const user = userEvent.setup();
    const { store } = renderChat();

    await user.type(screen.getByRole("searchbox", { name: /search conversations/i }), "Nurul");
    const queue = screen.getByRole("region", { name: "Conversation queue" });
    expect(within(queue).getByText("Nurul Aisyah")).toBeInTheDocument();
    expect(within(queue).queryByText("Ahmad bin Hassan")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Nurul Aisyah",
    );

    await user.clear(screen.getByRole("searchbox", { name: /search conversations/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /filter conversations/i }), [
      "resolved",
    ]);
    expect(within(queue).getByText("Rajesh Kumar")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: /search conversations/i }));
    await user.type(screen.getByRole("searchbox", { name: /search conversations/i }), "nobody");
    expect(queue).toHaveTextContent("No conversations match this search or filter.");
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Select a conversation",
    );
    expect(screen.queryByRole("textbox", { name: /message/i })).not.toBeInTheDocument();
    expect(store.getState().state.selections.conversationId).toBeNull();
  });

  it("sends a reply, records an internal note, resolves, and reopens the conversation", async () => {
    const user = userEvent.setup();
    renderChat();

    const message = screen.getByRole("textbox", { name: "Message" });
    await user.type(message, "Please visit the nearest emergency department now.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(
      within(screen.getByRole("region", { name: "Selected conversation" })).getByText(
        "Please visit the nearest emergency department now.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Internal note" }));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Call reviewed by staff.");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByText("Internal note: Call reviewed by staff.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/moves this conversation to Done/i);
    await user.click(within(dialog).getByRole("button", { name: "Resolve conversation" }));
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it("edits patient details, handles booking approval, labels, and emergency escalation", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Edit patient" }));
    const name = screen.getByRole("textbox", { name: "Patient name" });
    await user.clear(name);
    await user.type(name, "Ahmad Hassan");
    await user.click(screen.getByRole("button", { name: "Save patient" }));
    expect(screen.getAllByText("Ahmad Hassan").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole("combobox", { name: "Add label" }), "follow-up");
    await user.click(screen.getByRole("button", { name: "Add selected label" }));
    expect(screen.getByText("follow-up")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Escalate emergency" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "This turns off the synthetic agent and keeps the thread with staff. This demo does not contact a nurse, ambulance, 999, or any external service.",
    );
    await user.click(screen.getByRole("button", { name: "Confirm staff handoff" }));
    expect(
      within(screen.getByRole("complementary", { name: "Patient context" })).getByText(
        "Staff only",
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open conversation with Nurul Aisyah" }),
    );
    await user.click(screen.getByRole("button", { name: "Approve booking" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Confirm this appointment?" });
    expect(confirmation).toHaveTextContent("Temu janji anda disahkan");
    await user.click(
      within(confirmation).getByRole("button", { name: "Confirm and notify" }),
    );
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Temu janji anda disahkan",
    );
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Your appointment is confirmed",
    );
  });

  it("previews and sends a pending booking update from patient context", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: /Nurul Aisyah/i }));
    await user.click(screen.getByRole("button", { name: "Edit booking" }));
    const dialog = screen.getByRole("dialog", { name: "Edit booking" });
    const save = within(dialog).getByRole("button", { name: "Save and notify" });
    expect(within(dialog).getByText("Patient message")).toBeInTheDocument();
    expect(save).toBeDisabled();
    const dateTime = within(dialog).getByLabelText("Booking date and time");
    const provider = within(dialog).getByLabelText("Booking provider");
    const reason = within(dialog).getByLabelText("Booking reason");
    await user.clear(dateTime);
    await user.type(dateTime, "2026-07-10T14:30");
    await user.clear(provider);
    await user.type(provider, "Dr. Amir Lee");
    await user.clear(reason);
    await user.type(reason, "Medication review");
    expect(within(dialog).getByText(/Permintaan temu janji anda telah dikemas kini/)).toBeVisible();
    expect(within(dialog).getByText(/Your appointment request was updated/)).toBeVisible();
    await user.click(save);

    const rail = screen.getByRole("complementary", { name: "Patient context" });
    expect(within(rail).getByText("Dr. Amir Lee")).toBeInTheDocument();
    expect(within(rail).getByText("Medication review")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Permintaan temu janji anda telah dikemas kini",
    );
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Booking request updated",
    );
  });

  it("cancels an approved appointment, notifies the patient, and removes it from Schedule", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: /Nurul Aisyah/i }));
    await user.click(screen.getByRole("button", { name: "Approve booking" }));
    await user.click(
      within(screen.getByRole("alertdialog", { name: "Confirm this appointment?" })).getByRole(
        "button",
        { name: "Confirm and notify" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Cancel appointment" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel this appointment?" });
    expect(dialog).toHaveTextContent("Temu janji anda");
    expect(dialog).toHaveTextContent("dibatalkan");
    await user.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));

    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Booking cancelled",
    );
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByText("No synthetic bookings in this seven-day window.")).toBeInTheDocument();
  });

  it("simulates a deterministic patient and supports the schedule-to-thread flow", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("button", { name: "Simulate Patient" }));
    const dialog = screen.getByRole("dialog", { name: "Simulate Patient" });
    expect(within(dialog).queryByRole("option", { name: "Walk-in registration" })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Scenario" }), [
      "mandarin_voice",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Add synthetic patient" }));
    expect(screen.getAllByText("Li Wei").length).toBeGreaterThan(0);
    expect(screen.getByText("我想了解处方续药流程。")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByRole("region", { name: "Schedule day index" })).toHaveTextContent(
      "1 booking",
    );
    await user.click(
      screen.getByRole("button", { name: "Open conversation with Nurul Aisyah" }),
    );
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Selected conversation" })).toHaveTextContent(
      "Nurul Aisyah",
    );
  });

  it("opens the shared booking editor from Schedule and reflects the selected day count", async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.queryByText("No clinic booking was made.")).not.toBeInTheDocument();
    expect(screen.getByText("1 booking scheduled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit booking for Nurul Aisyah" }));
    expect(screen.getByRole("dialog", { name: "Edit booking" })).toBeInTheDocument();
  });

  it("uses list to thread to details choreography on mobile", async () => {
    const user = userEvent.setup();
    renderChat({ width: 390 });

    expect(screen.getByRole("region", { name: "Conversation queue" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Patient context" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open conversation with Ahmad/i }));
    expect(screen.getByRole("region", { name: "Selected conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Conversation queue" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("complementary", { name: "Patient context" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Selected conversation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close details" }));
    await user.click(screen.getByRole("button", { name: "Back to queue" }));
    expect(screen.getByRole("region", { name: "Conversation queue" })).toBeInTheDocument();
  });

  it("imports the latest staff reply into Eval and opens the routed Dream playbook", async () => {
    const user = userEvent.setup();
    const { store } = renderChat();
    const before = store.getState().state.evalDatasets[0]!.cases.length;

    await user.click(screen.getByRole("button", { name: /Nurul Aisyah/i }));
    const importConversation = screen.getByRole("button", {
      name: "Add resolved conversation to Evals",
    });
    expect(importConversation).toBeDisabled();
    expect(screen.getByText("Resolve this conversation before adding it to Evals.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Resolve conversation",
      }),
    );
    expect(importConversation).toBeEnabled();
    await user.click(importConversation);
    expect(screen.getByText("Evaluation Lab destination")).toBeInTheDocument();
    expect(store.getState().state.evalDatasets[0]!.cases).toHaveLength(before);
  });

  it("shows fixture triage only and keeps full queue timestamps", async () => {
    const user = userEvent.setup();
    renderChat();

    const emergencyRow = screen.getByRole("button", {
      name: "Open conversation with Ahmad bin Hassan",
    });
    expect(emergencyRow).toHaveTextContent("2026");
    expect(screen.getByText(/Chest-pain fixture:/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open conversation with Rajesh Kumar" }),
    );
    expect(screen.getByText("No synthetic triage guidance for this patient.")).toBeInTheDocument();
  });

  it("keeps Filter and Simulate Patient inside More at 320px", async () => {
    const user = userEvent.setup();
    renderChat({ width: 320 });

    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Filter")).toBeInTheDocument();
    expect(within(menu).getByText("Simulate Patient")).toBeInTheDocument();
  });
});
