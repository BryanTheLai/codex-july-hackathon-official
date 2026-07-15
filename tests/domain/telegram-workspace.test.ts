import { describe, expect, it } from "vitest";

import { mergeTelegramWorkspaceState } from "../../src/domain/telegram-workspace";
import {
  createCanonicalSeed,
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";

async function serverStateWithTelegram() {
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

describe("Telegram workspace projection", () => {
  it("adds server Telegram threads without replacing local synthetic state", async () => {
    const local = createCanonicalSeed();
    const projected = mergeTelegramWorkspaceState(
      local,
      await serverStateWithTelegram(),
    );
    const telegram = projected.state.conversations[0];

    expect(telegram).toMatchObject({
      id: "telegram-conversation:-10042",
      channel: "Telegram",
      patient: {
        name: "Aina Zulkifli",
        phone: "",
        medicalRecordNumber: "",
        preferredLanguage: "Malay",
      },
      agentMode: "synthetic_agent",
      messages: [
        {
          id: "telegram-message:-10042:88",
          text: "Boleh saya buat temujanji?",
        },
      ],
    });
    expect(projected.conversationRevisions).toEqual({
      "telegram-conversation:-10042": 1,
    });
    expect(
      projected.state.conversations.some(
        (conversation) => conversation.id === local.conversations[0]!.id,
      ),
    ).toBe(true);
    expect(projected.state.playbookFiles).toEqual(local.playbookFiles);
    expect(projected.state.evalDatasets).toEqual(local.evalDatasets);
  });

  it("replaces prior Telegram views, removes deleted ones, and preserves valid selection", async () => {
    const first = mergeTelegramWorkspaceState(
      createCanonicalSeed(),
      await serverStateWithTelegram(),
    );
    const selected = {
      ...first.state,
      selections: {
        ...first.state.selections,
        conversationId: "telegram-conversation:-10042",
      },
    };
    const emptyServer = await createCanonicalServerState();

    const projected = mergeTelegramWorkspaceState(selected, emptyServer);

    expect(
      projected.state.conversations.some(
        (conversation) => conversation.id === "telegram-conversation:-10042",
      ),
    ).toBe(false);
    expect(projected.state.selections.conversationId).toBe(
      projected.state.conversations[0]!.id,
    );
    expect(projected.conversationRevisions).toEqual({});
  });
});
