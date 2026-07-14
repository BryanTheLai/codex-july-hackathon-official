import type {
  AppState,
  Conversation,
  Criterion,
  EvalCase,
  EvalCaseType,
  Message,
} from "./types";

export type HitlImportAvailability =
  | { status: "ready"; inputMessages: Message[]; staff: Message }
  | { status: "unresolved" }
  | { status: "no_staff_reply" }
  | { status: "already_imported" };

export function inferCaseType(conversation: AppState["conversations"][number]): EvalCaseType {
  if (conversation.urgency === "emergency" || conversation.labels.includes("emergency")) {
    return "emergency_triage";
  }
  if (conversation.labels.includes("booking") || conversation.booking) {
    return "booking";
  }
  if (conversation.labels.includes("prescription")) {
    return "prescription";
  }
  if (conversation.labels.includes("lab-results")) {
    return "lab_follow_up";
  }
  return "general";
}

export function defaultCriteriaForType(type: EvalCaseType, criteria: Criterion[]): string[] {
  return criteria
    .filter(
      (item) => item.caseTypes && item.caseTypes.length > 0 && item.caseTypes.includes(type),
    )
    .map((item) => item.id);
}

export function hitlFingerprint(messages: EvalCase["inputConversation"]["messages"], expected: string): string {
  const ids = messages.map((message) => message.id).join("|");
  return `${ids}::${expected}`;
}

export function hitlImportAvailability(
  conversation: Conversation,
  dataset: AppState["evalDatasets"][number],
): HitlImportAvailability {
  if (conversation.workflowStatus !== "resolved") {
    return { status: "unresolved" };
  }

  const nonSystem = conversation.messages.filter((message) => message.role !== "system");
  let staffIndex = -1;
  for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
    if (nonSystem[index]?.role === "staff") {
      staffIndex = index;
      break;
    }
  }
  const staff = nonSystem[staffIndex];
  if (!staff) {
    return { status: "no_staff_reply" };
  }

  const inputMessages = nonSystem.slice(0, staffIndex);
  const fingerprint = hitlFingerprint(inputMessages, staff.text);
  const imported = dataset.cases.some(
    (evalCase) =>
      evalCase.sourceConversationId === conversation.id ||
      hitlFingerprint(evalCase.inputConversation.messages, evalCase.expectedHumanOutput) ===
        fingerprint,
  );
  if (imported) {
    return { status: "already_imported" };
  }
  return { inputMessages, staff, status: "ready" };
}

export function applicableCriteria(dataset: AppState["evalDatasets"][number], evalCase: EvalCase): Criterion[] {
  if (evalCase.criterionIds.length > 0) {
    return dataset.criteria.filter((item) => evalCase.criterionIds.includes(item.id));
  }
  return dataset.criteria;
}

export function playbookIdForConversation(conversation: Conversation): string {
  if (conversation.labels.includes("booking") || conversation.booking) {
    return "file-malay-booking";
  }
  if (conversation.labels.includes("prescription")) {
    return "file-mandarin-prescription";
  }
  if (
    conversation.urgency === "emergency" ||
    conversation.labels.includes("emergency") ||
    conversation.labels.includes("triage")
  ) {
    return "file-triage";
  }
  return "file-triage";
}

export function playbookIdForCaseType(type: EvalCaseType): string {
  switch (type) {
    case "booking":
      return "file-malay-booking";
    case "prescription":
      return "file-mandarin-prescription";
    case "emergency_triage":
    case "lab_follow_up":
    case "general":
      return "file-triage";
    default:
      return assertNever(type);
  }
}

export function messageDigest(messages: EvalCase["inputConversation"]["messages"]): string {
  return messages.map((message) => `${message.role}:${message.text}`).join(" ");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled eval case type: ${String(value)}`);
}
