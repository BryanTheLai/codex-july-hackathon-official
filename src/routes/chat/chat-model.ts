import type { Conversation, Message } from "../../domain";

export type ChatFilter = "all" | "needs_review" | "ai_handling" | "resolved";
export type ChatView = "inbox" | "schedule";
export type MobilePane = "list" | "thread" | "details";

export const QUEUE_GROUPS = [
  "Emergency",
  "Booking details",
  "Waiting",
  "Autonomous agent",
  "Done",
] as const;

export type QueueGroup = (typeof QUEUE_GROUPS)[number];

export function conversationGroup(conversation: Conversation): QueueGroup {
  if (conversation.urgency === "emergency" && conversation.workflowStatus !== "resolved") {
    return "Emergency";
  }
  if (conversation.booking?.status === "pending") {
    return "Booking details";
  }
  if (conversation.workflowStatus === "resolved") {
    return "Done";
  }
  if (conversation.agentMode === "synthetic_agent") {
    return "Autonomous agent";
  }
  return "Waiting";
}

export function latestVisibleMessage(conversation: Conversation): Message | undefined {
  return [...conversation.messages].reverse().find((message) => message.role !== "system");
}

function matchesFilter(conversation: Conversation, filter: ChatFilter): boolean {
  if (filter === "needs_review") {
    return conversation.urgency === "emergency" || conversation.booking?.status === "pending";
  }
  if (filter === "ai_handling") {
    return (
      conversation.workflowStatus !== "resolved" &&
      conversation.agentMode === "synthetic_agent"
    );
  }
  if (filter === "resolved") {
    return conversation.workflowStatus === "resolved";
  }
  return true;
}

function matchesSearch(conversation: Conversation, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  const searchable = [
    conversation.patient.name,
    conversation.patient.phone,
    conversation.patient.medicalRecordNumber,
    conversation.channel,
    ...conversation.labels,
    ...conversation.messages.flatMap((message) => [message.text, message.gloss ?? ""]),
  ];
  return searchable.some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function visibleConversations(
  conversations: Conversation[],
  query: string,
  filter: ChatFilter,
): Conversation[] {
  return conversations.filter(
    (conversation) => matchesFilter(conversation, filter) && matchesSearch(conversation, query),
  );
}

export function groupedConversations(conversations: Conversation[]) {
  return QUEUE_GROUPS.map((group) => ({
    group,
    conversations: conversations.filter((conversation) => conversationGroup(conversation) === group),
  })).filter((entry) => entry.conversations.length > 0);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date(iso)) + " MYT";
}

export function formatFullTimestamp(iso: string): string {
  return `${new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date(iso))} MYT`;
}

export function formatBookingSlot(iso: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
  }).format(new Date(iso));
}

export function triageGuidance(conversation: Conversation): string {
  return conversation.triageGuidance ?? "No synthetic triage guidance for this patient.";
}

export function scheduleDays(fixtureTime: string) {
  const start = new Date(`${fixtureTime.slice(0, 10)}T12:00:00+08:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86_400_000);
    const isoDate = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    const label = new Intl.DateTimeFormat("en-MY", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kuala_Lumpur",
      weekday: "short",
    }).format(date);
    return { isoDate, label };
  });
}

export function hasResolvedStaffReply(conversation: Conversation): boolean {
  return (
    conversation.workflowStatus === "resolved" &&
    conversation.messages.some((message) => message.role === "staff")
  );
}
