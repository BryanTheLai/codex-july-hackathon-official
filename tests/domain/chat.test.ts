import { describe, expect, it } from "vitest";

import * as domain from "../../src/domain";
import {
  SCHEMA_VERSION,
  FIXTURE_TIME_ISO,
  addLabel,
  approveBooking,
  cancelBooking,
  createCanonicalSeed,
  escalateEmergency,
  rejectBooking,
  removeLabel,
  resetSyntheticConversation,
  reopenConversation,
  resolveConversation,
  resetDemo,
  sendStaffReply,
  setAgentMode,
  simulatePatient,
  updateBooking,
  updatePatient,
  type AppState,
  type ConversationId,
} from "../../src/domain";

function convoIds(state: AppState): ConversationId[] {
  return state.conversations.map((c) => c.id);
}

function otherConversations(state: AppState, id: ConversationId) {
  return state.conversations.filter((c) => c.id !== id);
}

function withPendingBooking(state: AppState, conversationId: ConversationId): AppState {
  return {
    ...structuredClone(state),
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            booking: {
              slotIso: "2026-07-19T10:00:00+08:00",
              reason: "General service",
              status: "pending" as const,
              revision: 1,
            },
          }
        : conversation,
    ),
  };
}

function withEmergencyConversation(state: AppState): AppState {
  const emergency = {
    ...structuredClone(state.conversations[0]!),
    id: "convo-test-emergency",
    urgency: "emergency" as const,
    labels: ["emergency", "simulated"],
  };
  return {
    ...structuredClone(state),
    conversations: [emergency, ...state.conversations],
  };
}

describe("canonical seed", () => {
  it("has the current schema version, three conversations, and stable fixture time", () => {
    const seed = createCanonicalSeed();

    expect(seed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(seed.conversations).toHaveLength(3);
    expect(seed.fixtureTime).toBe(FIXTURE_TIME_ISO);
    expect(seed.conversations.every((c) => c.messages.length > 0)).toBe(true);
  });

  it("starts with no seed corrections", () => {
    const seed = createCanonicalSeed();

    expect(seed.corrections).toHaveLength(0);
  });

  it("matches fixture inventory counts and ungraded seed eval state", () => {
    const seed = createCanonicalSeed();
    const dataset = seed.evalDatasets.find((d) => d.id === "dataset-aircon-ops")!;

    expect(seed.playbookFiles).toHaveLength(3);
    expect(seed.corrections.filter((c) => c.status === "pending")).toHaveLength(0);
    expect(dataset.cases).toHaveLength(5);
    expect(dataset.cases.filter((c) => c.split === "train")).toHaveLength(3);
    expect(dataset.cases.filter((c) => c.split === "holdout")).toHaveLength(2);
    expect(dataset.cases.map((evalCase) => evalCase.source.kind)).toEqual([
      "seed",
      "seed",
      "seed",
      "seed",
      "seed",
    ]);
    expect(
      dataset.cases.map(({ language, split, type }) => ({ language, split, type })),
    ).toEqual([
      { language: "Malay", split: "train", type: "general" },
      { language: "English", split: "train", type: "general" },
      { language: "English", split: "train", type: "booking" },
      { language: "English", split: "holdout", type: "general" },
      { language: "Malay", split: "holdout", type: "general" },
    ]);
    expect(dataset.criteria).toHaveLength(3);
    expect(dataset.candidateVersion).toBe(1);
    expect(dataset.suiteSnapshots).toHaveLength(0);
    expect(dataset.runHistory).toHaveLength(0);
    expect(dataset.cases.every((c) => c.actualSyntheticOutput === undefined)).toBe(true);
    expect(dataset.cases.every((c) => c.grade === undefined)).toBe(true);
  });

  it("uses aircon demo selections and empty MRN strings", () => {
    const seed = createCanonicalSeed();

    expect(seed.selections).toEqual({
      conversationId: "convo-aircon-booking",
      playbookFileId: "file-aircon-rate-card",
      evalDatasetId: "dataset-aircon-ops",
    });
    expect(seed.conversations.every((c) => c.patient.medicalRecordNumber === "")).toBe(true);
  });
});

describe("sendStaffReply", () => {
  it("appends one trimmed staff message and leaves other conversations unchanged", () => {
    const seed = createCanonicalSeed();
    const targetId = seed.conversations.find((c) => c.workflowStatus !== "resolved")!.id;
    const beforeOthers = structuredClone(otherConversations(seed, targetId));

    const result = sendStaffReply(seed, {
      conversationId: targetId,
      text: "  Please rest and monitor symptoms.  ",
      kind: "reply",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.state.conversations.find((c) => c.id === targetId)!;
    const staffMessages = target.messages.filter((m) => m.role === "staff");
    expect(staffMessages.at(-1)?.text).toBe("Please rest and monitor symptoms.");

    for (const before of beforeOthers) {
      const after = result.state.conversations.find((c) => c.id === before.id)!;
      expect(after).toEqual(before);
    }
    expect(result.state).not.toBe(seed);
  });

  it("stores patient-facing translated text with its English translation", () => {
    const seed = createCanonicalSeed();
    const targetId = "convo-aircon-booking";

    const result = sendStaffReply(seed, {
      conversationId: targetId,
      text: "Please bring your identity card fifteen minutes before arrival.",
      kind: "reply",
      translation: {
        language: "Malay",
        text: "Sila bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const message = result.state.conversations
      .find((conversation) => conversation.id === targetId)!
      .messages.at(-1);
    expect(message).toMatchObject({
      role: "staff",
      language: "Malay",
      text: "Sila bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
      gloss: "Please bring your identity card fifteen minutes before arrival.",
    });
  });

  it("rejects empty trimmed text with typed failure", () => {
    const seed = createCanonicalSeed();
    const targetId = seed.conversations.find((c) => c.workflowStatus !== "resolved")!.id;

    const result = sendStaffReply(seed, {
      conversationId: targetId,
      text: "   ",
      kind: "reply",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/empty/i);
    expect(result.state.conversations).toEqual(seed.conversations);
  });

  it("blocks send on resolved conversations", () => {
    const seed = createCanonicalSeed();
    const resolved = seed.conversations.find((c) => c.workflowStatus === "resolved");
    expect(resolved).toBeDefined();
    if (!resolved) return;

    const result = sendStaffReply(seed, {
      conversationId: resolved.id,
      text: "Follow up next week",
      kind: "reply",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/resolved/i);
    expect(result.state).toEqual(seed);
  });
});

describe("resolve and reopen", () => {
  it("resolve disables sending; reopen restores in-progress workflow", () => {
    const seed = createCanonicalSeed();
    const activeId = seed.conversations.find((c) => c.workflowStatus !== "resolved")!.id;

    const resolved = resolveConversation(seed, activeId);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const resolvedConvo = resolved.state.conversations.find((c) => c.id === activeId)!;
    expect(resolvedConvo.workflowStatus).toBe("resolved");
    expect(resolvedConvo.resolvedAt).toBe(FIXTURE_TIME_ISO);

    const blocked = sendStaffReply(resolved.state, {
      conversationId: activeId,
      text: "Cannot send now",
      kind: "reply",
    });
    expect(blocked.ok).toBe(false);

    const reopened = reopenConversation(resolved.state, activeId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const reopenedConvo = reopened.state.conversations.find((c) => c.id === activeId)!;
    expect(reopenedConvo.workflowStatus).toBe("in_progress");
    expect(reopenedConvo.resolvedAt).toBeNull();

    const allowed = sendStaffReply(reopened.state, {
      conversationId: activeId,
      text: "Back in progress",
      kind: "reply",
    });
    expect(allowed.ok).toBe(true);
  });
});

describe("updatePatient", () => {
  it("commits valid fields atomically and rejects empty name or phone", () => {
    const seed = createCanonicalSeed();
    const targetId = seed.conversations[0]!.id;
    const before = seed.conversations[0]!.patient;

    const invalid = updatePatient(seed, targetId, {
      name: "  ",
      phone: before.phone,
      preferredLanguage: before.preferredLanguage,
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.state.conversations[0]!.patient).toEqual(before);

    const invalidLanguage = updatePatient(seed, targetId, {
      name: before.name,
      phone: before.phone,
      preferredLanguage: "   ",
    });
    expect(invalidLanguage.ok).toBe(false);
    if (invalidLanguage.ok) return;
    expect(invalidLanguage.error).toMatch(/preferred language/i);
    expect(invalidLanguage.state.conversations[0]!.patient).toEqual(before);

    const valid = updatePatient(seed, targetId, {
      name: "Updated Name",
      phone: "+60123456789",
      preferredLanguage: "English",
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const patient = valid.state.conversations.find((c) => c.id === targetId)!.patient;
    expect(patient.name).toBe("Updated Name");
    expect(patient.phone).toBe("+60123456789");
    expect(patient.preferredLanguage).toBe("English");
  });
});

describe("booking decisions", () => {
  it("approves a pending request with a patient confirmation and separate audit", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending");
    expect(withBooking).toBeDefined();
    if (!withBooking?.booking) return;

    const approved = approveBooking(seed, withBooking.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const approvedConvo = approved.state.conversations.find((c) => c.id === withBooking.id)!;
    expect(approvedConvo.booking?.status).toBe("approved");
    expect(approvedConvo.booking?.revision).toBe(2);
    expect(approvedConvo.messages.at(-2)).toMatchObject({
      role: "staff",
      language: "Malay",
    });
    expect(approvedConvo.messages.at(-2)?.gloss).toContain("appointment is confirmed");
    expect(approvedConvo.messages.at(-1)).toMatchObject({ role: "system" });
    expect(approvedConvo.messages.at(-1)?.text).toContain("Booking approved");
  });

  it("rejects a pending request with a patient update and separate audit", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending");
    expect(withBooking).toBeDefined();
    if (!withBooking?.booking) return;
    const rejected = rejectBooking(seed, withBooking.id);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const rejectedConvo = rejected.state.conversations.find((c) => c.id === withBooking.id)!;
    expect(rejectedConvo.booking?.status).toBe("rejected");
    expect(rejectedConvo.booking?.revision).toBe(2);
    expect(rejectedConvo.messages.at(-2)).toMatchObject({
      role: "staff",
      language: "Malay",
    });
    expect(rejectedConvo.messages.at(-2)?.gloss).toContain("could not confirm");
    expect(rejectedConvo.messages.at(-1)).toMatchObject({ role: "system" });
    expect(rejectedConvo.messages.at(-1)?.text).toContain("Booking rejected");
  });

  it("updates a pending request without calling it a reschedule", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending")!;

    const result = updateBooking(seed, withBooking.id, {
      expectedRevision: withBooking.booking!.revision,
      reason: "Medication review",
      slotIso: "2026-07-10T14:30:00+08:00",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.state.conversations.find((c) => c.id === withBooking.id)!;
    expect(updated.booking).toMatchObject({
      reason: "Medication review",
      slotIso: "2026-07-10T14:30:00+08:00",
    });
    expect(updated.booking?.revision).toBe(2);
    expect(updated.messages.at(-2)?.gloss).toContain("appointment request was updated");
    expect(updated.messages.at(-2)?.gloss).not.toContain("rescheduled");
    expect(updated.messages.at(-1)?.text).toContain("Booking request updated");
  });

  it("reschedules an approved appointment and notifies the patient", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending")!;
    const approved = approveBooking(seed, withBooking.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const approvedConversation = approved.state.conversations.find((c) => c.id === withBooking.id)!;

    const result = updateBooking(approved.state, withBooking.id, {
      expectedRevision: approvedConversation.booking!.revision,
      reason: "General consult",
      slotIso: "2026-07-10T14:30:00+08:00",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.state.conversations.find((c) => c.id === withBooking.id)!;
    expect(updated.messages.at(-2)?.gloss).toContain("appointment has been rescheduled");
    expect(updated.messages.at(-1)?.text).toContain("Booking rescheduled");
  });

  it("rejects an invalid booking edit without changing the booking", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending")!;
    const before = structuredClone(withBooking.booking);

    const result = updateBooking(seed, withBooking.id, {
      expectedRevision: withBooking.booking!.revision,
      reason: "Medication review",
      slotIso: "not-a-date",
    });

    expect(result.ok).toBe(false);
    expect(result.state.conversations.find((c) => c.id === withBooking.id)?.booking).toEqual(before);
  });

  it("rejects unchanged and stale booking edits without appending messages", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending")!;
    const beforeMessageCount = withBooking.messages.length;

    const unchanged = updateBooking(seed, withBooking.id, {
      expectedRevision: withBooking.booking!.revision,
      reason: withBooking.booking!.reason,
      slotIso: withBooking.booking!.slotIso,
    });
    expect(unchanged.ok).toBe(false);
    if (unchanged.ok) return;
    expect(unchanged.error).toMatch(/did not change/i);
    expect(unchanged.state.conversations.find((c) => c.id === withBooking.id)?.messages).toHaveLength(
      beforeMessageCount,
    );

    const stale = updateBooking(seed, withBooking.id, {
      expectedRevision: 0,
      reason: "Medication review",
      slotIso: "2026-07-10T14:30:00+08:00",
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error).toMatch(/changed before/i);
    expect(stale.state).toEqual(seed);
  });

  it("cancels an approved appointment without treating it as a rejected request", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const withBooking = seed.conversations.find((c) => c.booking?.status === "pending")!;
    const approved = approveBooking(seed, withBooking.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const cancelled = cancelBooking(approved.state, withBooking.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    const conversation = cancelled.state.conversations.find((c) => c.id === withBooking.id)!;
    expect(conversation.booking?.status).toBe("cancelled");
    expect(conversation.booking?.revision).toBe(3);
    expect(conversation.messages.at(-2)?.gloss).toContain("appointment");
    expect(conversation.messages.at(-2)?.gloss).toContain("cancelled");
    expect(conversation.messages.at(-1)?.text).toContain("Booking cancelled");

    const rejected = rejectBooking(seed, withBooking.id);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const invalidCancel = cancelBooking(rejected.state, withBooking.id);
    expect(invalidCancel.ok).toBe(false);
    if (invalidCancel.ok) return;
    expect(invalidCancel.error).toMatch(/approved/i);
  });
});

describe("emergency escalation", () => {
  it("forces staff-only agent mode and never records external contact", () => {
    const seed = withEmergencyConversation(createCanonicalSeed());
    const emergency = seed.conversations.find((c) => c.urgency === "emergency");
    expect(emergency).toBeDefined();
    if (!emergency) return;

    const result = escalateEmergency(seed, emergency.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = result.state.conversations.find((c) => c.id === emergency.id)!;
    expect(updated.agentMode).toBe("staff_only");

    const audit = updated.messages.filter((m) => m.role === "system");
    expect(audit.length).toBeGreaterThan(0);
    for (const message of audit) {
      expect(message.text).not.toMatch(/999|ambulance|nurse|contacted/i);
      expect(message.text).toMatch(/demo|staff|synthetic/i);
    }
  });
});

describe("labels", () => {
  it("dedupes add and supports remove", () => {
    const seed = createCanonicalSeed();
    const targetId = seed.conversations[0]!.id;
    const label = "triage";

    const first = addLabel(seed, targetId, label);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.conversations.find((c) => c.id === targetId)!.labels).toContain(label);

    const dup = addLabel(first.state, targetId, label);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toMatch(/exist|duplicate|already/i);

    const removed = removeLabel(first.state, targetId, label);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.state.conversations.find((c) => c.id === targetId)!.labels).not.toContain(label);
  });
});

describe("setAgentMode", () => {
  it("updates only the selected conversation, blocks resolved, and appends audit", () => {
    const seed = createCanonicalSeed();
    const selectedId = seed.selections.conversationId!;
    const otherId = seed.conversations.find((c) => c.id !== selectedId)!.id;
    const beforeOther = structuredClone(seed.conversations.find((c) => c.id === otherId)!);

    const blocked = setAgentMode(seed, {
      conversationId: seed.conversations.find((c) => c.workflowStatus === "resolved")!.id,
      mode: "staff_only",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/resolved/i);

    const changed = setAgentMode(seed, {
      conversationId: selectedId,
      mode: "staff_only",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    const selected = changed.state.conversations.find((c) => c.id === selectedId)!;
    expect(selected.agentMode).toBe("staff_only");
    expect(
      selected.messages.some(
        (m) => m.role === "system" && /agent mode|staff only|synthetic agent/i.test(m.text),
      ),
    ).toBe(true);
    expect(changed.state.conversations.find((c) => c.id === otherId)).toEqual(beforeOther);
  });
});

describe("simulatePatient", () => {
  it("is deterministic and idempotent per reset for each scenario", () => {
    const seed = createCanonicalSeed();
    const scenario = "aircon_malay_booking" as const;

    const first = simulatePatient(seed, scenario);
    const second = simulatePatient(seed, scenario);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const firstNew = first.state.conversations.find(
      (c) => !convoIds(seed).includes(c.id),
    )!;
    const secondNew = second.state.conversations.find(
      (c) => !convoIds(seed).includes(c.id),
    )!;
    expect(firstNew).toEqual(secondNew);

    const afterReset = simulatePatient(createCanonicalSeed(), scenario);
    expect(afterReset.ok).toBe(true);
    if (!afterReset.ok) return;
    const resetNew = afterReset.state.conversations.find(
      (c) => !convoIds(createCanonicalSeed()).includes(c.id),
    )!;
    expect(resetNew).toEqual(firstNew);
  });

  it("re-selects an already-present scenario without duplicating the conversation", () => {
    const seed = createCanonicalSeed();
    const scenario = "aircon_malay_booking" as const;

    const first = simulatePatient(seed, scenario);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const countAfterFirst = first.state.conversations.length;
    expect(first.state.selections.conversationId).toBe("sim-aircon-malay-booking");

    const second = simulatePatient(first.state, scenario);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.conversations).toHaveLength(countAfterFirst);
    expect(second.state.selections.conversationId).toBe("sim-aircon-malay-booking");
  });

  it("uses the active state fixture time for simulated messages", () => {
    const state = {
      ...createCanonicalSeed(),
      fixtureTime: "2026-07-12T16:30:00+08:00",
    };

    const result = simulatePatient(state, "aircon_package_complaint");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const simulated = result.state.conversations.find(
      (conversation) => conversation.id === "sim-aircon-package-complaint",
    );
    expect(simulated?.messages.every((message) => message.sentAt === state.fixtureTime)).toBe(true);
  });
});

describe("resetSyntheticConversation", () => {
  it("restores one canonical fixture without changing another conversation", () => {
    const seed = withPendingBooking(createCanonicalSeed(), "convo-aircon-booking");
    const target = seed.conversations.find((conversation) => conversation.id === "convo-aircon-booking")!;
    const untouched = seed.conversations.find((conversation) => conversation.id === "convo-aircon-complaint")!;
    const changed = updateBooking(seed, target.id, {
      expectedRevision: target.booking!.revision,
      reason: "Medication review",
      slotIso: "2026-07-10T14:30:00+08:00",
    });

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const reset = resetSyntheticConversation(changed.state, target.id);

    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.state.conversations.find((conversation) => conversation.id === target.id)).toEqual(
      createCanonicalSeed().conversations.find((conversation) => conversation.id === target.id),
    );
    expect(reset.state.conversations.find((conversation) => conversation.id === untouched.id)).toEqual(
      untouched,
    );
  });

  it("removes one simulated fixture and selects a remaining conversation", () => {
    const simulated = simulatePatient(createCanonicalSeed(), "aircon_malay_booking");
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;

    const reset = resetSyntheticConversation(simulated.state, "sim-aircon-malay-booking");

    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.state.conversations.some((conversation) => conversation.id === "sim-aircon-malay-booking")).toBe(
      false,
    );
    expect(reset.state.selections.conversationId).not.toBe("sim-aircon-malay-booking");
  });

  it("refuses to reset a non-synthetic conversation", () => {
    const seed = createCanonicalSeed();
    const telegramLike = {
      ...seed,
      conversations: [
        {
          ...seed.conversations[0]!,
          id: "telegram-conversation:123",
          channel: "Telegram",
        },
        ...seed.conversations.slice(1),
      ],
    };

    const result = resetSyntheticConversation(telegramLike, "telegram-conversation:123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/synthetic demo/i);
    }
  });
});

describe("resetDemo", () => {
  it("returns a deep canonical seed after domain mutations", () => {
    const seed = createCanonicalSeed();
    const activeId = seed.conversations.find((c) => c.workflowStatus !== "resolved")!.id;
    const mutated = sendStaffReply(seed, {
      conversationId: activeId,
      text: "Temporary mutation for reset test",
      kind: "reply",
    });
    expect(mutated.ok).toBe(true);
    if (!mutated.ok) return;

    const reset = resetDemo(mutated.state);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;

    expect(reset.state).toEqual(createCanonicalSeed());
    expect(reset.state).not.toBe(createCanonicalSeed());
    expect(reset.state.conversations).not.toBe(createCanonicalSeed().conversations);
  });
});

describe("composer draft boundary", () => {
  it("does not expose domain APIs for conversation-switch composer drafts", () => {
    const draftApis = Object.keys(domain).filter((name) =>
      /composer|draft.*conversation|conversation.*draft/i.test(name),
    );
    expect(draftApis).toEqual([]);
  });
});
