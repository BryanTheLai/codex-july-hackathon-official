import { describe, expect, it } from "vitest";

import {
  createCanonicalServerState,
  mergeTelegramInboundText,
} from "../../src/domain";
import { createAutonomousBookingToolExecutor } from "../../server/autonomous-booking-tools";
import { buildLiveAgentRunRequest } from "../../server/agent-workspace";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const now = () => new Date("2026-07-17T01:00:00.000Z");

async function configuredWorkspace() {
  const inbound = mergeTelegramInboundText(await createCanonicalServerState(), {
    channel: "telegram",
    externalEventId: "1001",
    externalConversationId: "-10042",
    externalMessageId: "88",
    sender: { externalId: "42", displayName: "Aina Zulkifli" },
    message: {
      kind: "text",
      text: "Please book an appointment.",
      language: "en",
    },
    receivedAt: "2026-07-17T01:00:00.000Z",
  });
  if (!inbound.ok) throw new Error(inbound.error);
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const workspace = await repository.bootstrap("demo", inbound.state);
  const conversation = workspace.state.conversations.find(
    (candidate) => candidate.id === "telegram-conversation:-10042",
  );
  if (!conversation) throw new Error("Telegram conversation is missing");
  return {
    executor: createAutonomousBookingToolExecutor({
      now,
      workspaceId: "demo",
      workspaceRepository: repository,
    }),
    repository,
    request: buildLiveAgentRunRequest(
      workspace.state,
      {
        conversationId: conversation.id,
        expectedConversationRevision: conversation.revision,
      },
      "agent-config-test",
    ),
  };
}

describe("autonomous booking tools", () => {
  it("lists, creates, and idempotently replays a confirmed booking without staff approval", async () => {
    const { executor, repository, request } = await configuredWorkspace();
    const availability = await executor({
      request,
      call: {
        callId: "call-list-1",
        name: "list_available_slots",
        argumentsJson: '{"date":null,"provider":"Dr. Farah"}',
      },
    });
    expect(availability.status).toBe("completed");
    const output = availability.output as {
      success: boolean;
      slots: Array<{ slotIso: string }>;
    };
    expect(output.success).toBe(true);
    const slotIso = output.slots[0]?.slotIso;
    if (!slotIso) throw new Error("No slot returned");

    const create = await executor({
      request,
      call: {
        callId: "call-create-1",
        name: "create_booking",
        argumentsJson: JSON.stringify({
          provider: "Dr. Farah",
          slotIso,
          reason: "Routine consultation",
        }),
      },
    });
    expect(create).toMatchObject({
      status: "completed",
      conversationRevision: 2,
      output: {
        success: true,
        action: "booking_created",
        booking: {
          provider: "Dr. Farah",
          slotIso,
          status: "approved",
          revision: 1,
        },
      },
    });
    const replay = await executor({
      request,
      call: {
        callId: "call-create-1",
        name: "create_booking",
        argumentsJson: JSON.stringify({
          provider: "Dr. Farah",
          slotIso,
          reason: "Routine consultation",
        }),
      },
    });
    expect(replay).toMatchObject({
      status: "completed",
      conversationRevision: 2,
      summary: "This autonomous action was already completed.",
    });

    const saved = await repository.load("demo");
    const conversation = saved?.state.conversations.find(
      (candidate) => candidate.id === request.conversation.id,
    );
    expect(conversation?.messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(conversation?.booking?.slotIso).toBe(slotIso);
  });

  it("rejects stale booking mutations and never changes the booking", async () => {
    const { executor, repository, request } = await configuredWorkspace();
    const workspace = await repository.load("demo");
    if (!workspace) throw new Error("Workspace missing");
    const current = workspace.state.conversations.find(
      (candidate) => candidate.id === request.conversation.id,
    );
    if (!current) throw new Error("Conversation missing");
    const changed = structuredClone(workspace.state);
    const index = changed.conversations.findIndex(
      (candidate) => candidate.id === current.id,
    );
    changed.conversations[index] = {
      ...current,
      revision: current.revision + 1,
      messages: [
        ...current.messages,
        {
          id: "new-patient-message",
          role: "patient",
          text: "Actually, next week please.",
          sentAt: "2026-07-17T01:05:00.000Z",
        },
      ],
    };
    await expect(repository.save("demo", workspace.revision, changed)).resolves.toMatchObject({
      ok: true,
    });

    const result = await executor({
      request,
      call: {
        callId: "call-stale-1",
        name: "create_booking",
        argumentsJson:
          '{"provider":"Dr. Farah","slotIso":"2026-07-17T09:00:00+08:00","reason":"Routine consultation"}',
      },
    });
    expect(result).toMatchObject({
      status: "failed",
      output: { success: false, error_type: "revision_conflict" },
    });
    const saved = await repository.load("demo");
    expect(
      saved?.state.conversations.find((candidate) => candidate.id === request.conversation.id)
        ?.booking,
    ).toBeUndefined();
  });

  it("reschedules and cancels a confirmed appointment autonomously", async () => {
    const { executor, repository, request } = await configuredWorkspace();
    const firstSlot = "2026-07-17T10:30:00+08:00";
    await expect(
      executor({
        request,
        call: {
          callId: "call-create-2",
          name: "create_booking",
          argumentsJson: JSON.stringify({
            provider: "Dr. Farah",
            slotIso: firstSlot,
            reason: "Routine consultation",
          }),
        },
      }),
    ).resolves.toMatchObject({ status: "completed", conversationRevision: 2 });
    const afterCreate = await repository.load("demo");
    const created = afterCreate?.state.conversations.find(
      (candidate) => candidate.id === request.conversation.id,
    );
    if (!afterCreate || !created) throw new Error("Created conversation is missing");
    const rescheduleRequest = buildLiveAgentRunRequest(
      afterCreate.state,
      {
        conversationId: created.id,
        expectedConversationRevision: created.revision,
      },
      "agent-config-test",
    );
    await expect(
      executor({
        request: rescheduleRequest,
        call: {
          callId: "call-reschedule-1",
          name: "reschedule_booking",
          argumentsJson:
            '{"provider":"Dr. Farah","slotIso":"2026-07-17T14:00:00+08:00","reason":"Routine consultation"}',
        },
      }),
    ).resolves.toMatchObject({
      status: "completed",
      conversationRevision: 3,
      output: { action: "booking_rescheduled" },
    });
    const afterReschedule = await repository.load("demo");
    const rescheduled = afterReschedule?.state.conversations.find(
      (candidate) => candidate.id === request.conversation.id,
    );
    if (!afterReschedule || !rescheduled) throw new Error("Rescheduled conversation is missing");
    const cancelRequest = buildLiveAgentRunRequest(
      afterReschedule.state,
      {
        conversationId: rescheduled.id,
        expectedConversationRevision: rescheduled.revision,
      },
      "agent-config-test",
    );
    await expect(
      executor({
        request: cancelRequest,
        call: {
          callId: "call-cancel-1",
          name: "cancel_booking",
          argumentsJson: "{}",
        },
      }),
    ).resolves.toMatchObject({
      status: "completed",
      conversationRevision: 4,
      output: { action: "booking_cancelled", booking: { status: "cancelled" } },
    });
  });
});
