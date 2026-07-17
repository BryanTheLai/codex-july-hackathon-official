import type { AppState, Conversation, EvalCaseType, Message, MutationResult } from "./types";
import { FIXTURE_TIME_ISO, SCHEMA_VERSION } from "./types";
import { cloneState, ok } from "./shared";

function msg(
  id: string,
  role: Message["role"],
  text: string,
  gloss?: string,
  language?: string,
): Message {
  return { id, role, text, gloss, language, sentAt: FIXTURE_TIME_ISO };
}

function conversation(partial: Conversation): Conversation {
  return partial;
}

function buildSeedState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    fixtureTime: FIXTURE_TIME_ISO,
    conversations: [
      conversation({
        id: "convo-aircon-booking",
        patient: {
          name: "Aina Demo",
          phone: "+601100000101",
          medicalRecordNumber: "",
          preferredLanguage: "Malay",
        },
        channel: "WhatsApp",
        urgency: "routine",
        agentMode: "synthetic_agent",
        workflowStatus: "in_progress",
        resolvedAt: null,
        labels: ["aircon", "booking", "general-service"],
        messages: [
          msg(
            "book-1",
            "patient",
            "Saya nak servis biasa untuk satu aircond wall unit 1.5 HP di SS2.",
          ),
          msg(
            "book-2",
            "synthetic_agent",
            "General service is RM99 per unit. Which date and time do you prefer?",
          ),
        ],
      }),
      conversation({
        id: "convo-aircon-complaint",
        patient: {
          name: "Farid Demo",
          phone: "+601100000102",
          medicalRecordNumber: "",
          preferredLanguage: "English",
        },
        channel: "WhatsApp",
        urgency: "routine",
        agentMode: "synthetic_agent",
        workflowStatus: "in_progress",
        resolvedAt: null,
        labels: ["aircon", "package-selection"],
        messages: [
          msg(
            "complaint-1",
            "patient",
            "My 1.5 HP wall unit is not cooling and smells musty.",
          ),
          msg("complaint-2", "synthetic_agent", "General service is RM99 per unit."),
          msg(
            "complaint-3",
            "patient",
            "That package is wrong. I said it is not cooling and smells musty.",
          ),
        ],
      }),
      conversation({
        id: "convo-aircon-resolved",
        patient: {
          name: "Mei Demo",
          phone: "+601100000103",
          medicalRecordNumber: "",
          preferredLanguage: "Malay",
        },
        channel: "WhatsApp",
        urgency: "routine",
        agentMode: "staff_only",
        workflowStatus: "resolved",
        resolvedAt: FIXTURE_TIME_ISO,
        labels: ["aircon", "resolved"],
        messages: [
          msg("resolved-1", "patient", "Terima kasih, servis sudah selesai."),
          msg("resolved-2", "staff", "Sama-sama. Job ini ditutup."),
          msg("resolved-3", "system", "Conversation resolved by staff."),
        ],
      }),
    ],
    playbookFolders: ["playbooks", "playbooks/data"],
    playbookFiles: [
      {
        id: "file-aircon-rate-card",
        path: "playbooks/aircon-rate-card.md",
        title: "Aircon rate card",
        savedContent:
          "# Aircon rate card\n\n- Supported scope: wall-mounted 1.0-1.5 HP units in the demo service area.\n- General service: RM99 per unit.\n- Chemical wash: RM160 per unit.\n- Prices are fixed. Do not invent discounts, parts, gas, or repair quotes.\n",
        updatedAt: FIXTURE_TIME_ISO,
        protected: true,
      },
      {
        id: "file-aircon-booking",
        path: "playbooks/aircon-booking.md",
        title: "Aircon booking",
        savedContent:
          "# Aircon booking\n\nCollect symptoms, unit type, horsepower, unit count, area, preferred slot, and\naddress. Offer only server-returned slots. Create the booking only after the\ncustomer explicitly confirms one slot and the address.\n",
        updatedAt: FIXTURE_TIME_ISO,
        protected: true,
      },
      {
        id: "file-aircon-service-selection",
        path: "playbooks/aircon-service-selection.md",
        title: "Aircon service selection",
        savedContent:
          "# Aircon service selection\n\nRoutine cleaning uses the RM99 general service.\nFor poor cooling and a musty smell, quote the RM99 general service.\nDo not diagnose parts or promise a repair outcome.\n",
        updatedAt: FIXTURE_TIME_ISO,
        protected: true,
      },
    ],
    corrections: [],
    evalDatasets: [
      {
        id: "dataset-aircon-ops",
        name: "Aircon service operations",
        protected: true,
        candidateVersion: 1,
        criteria: [
          {
            id: "crit-aircon-price",
            label: "Fixed rate card",
            instruction:
              "Use RM99 general service and RM160 chemical wash; do not invent discounts",
            required: true,
            examples: {
              good: "General service is RM99.",
              bad: "I can discount it to RM80.",
            },
            version: 1,
          },
          {
            id: "crit-aircon-selection",
            label: "Package selection",
            instruction: "Poor cooling plus musty smell requires chemical wash",
            required: true,
            caseTypes: ["general"],
            examples: {
              good: "Chemical wash is RM160.",
              bad: "General service is RM99.",
            },
            version: 1,
          },
          {
            id: "crit-aircon-confirm",
            label: "Explicit booking confirmation",
            instruction:
              "Do not create or claim a booking before explicit slot/address confirmation",
            required: true,
            caseTypes: ["booking"],
            examples: {
              good: "Please confirm the slot and address.",
              bad: "Your booking is confirmed.",
            },
            version: 1,
          },
        ],
        cases: [
          {
            id: "case-aircon-rate-card-train",
            title: "Malay general-service price",
            split: "train",
            type: "general",
            language: "Malay",
            inputConversation: {
              messages: [
                msg(
                  "case-aircon-rate-card-train-1",
                  "patient",
                  "Berapa servis biasa untuk wall unit 1.5 HP?",
                ),
              ],
            },
            expectedHumanOutput: "General service is RM99 per supported unit.",
            criterionIds: ["crit-aircon-price"],
            source: { kind: "seed" },
          },
          {
            id: "case-aircon-selection-train",
            title: "Combined symptoms need chemical wash",
            split: "train",
            type: "general",
            language: "English",
            inputConversation: {
              messages: [
                msg(
                  "case-aircon-selection-train-1",
                  "patient",
                  "My 1.5 HP wall unit is not cooling and smells musty.",
                ),
              ],
            },
            expectedHumanOutput:
              "For poor cooling and a musty smell, I recommend the RM160 chemical wash for one supported unit.",
            criterionIds: ["crit-aircon-selection", "crit-aircon-price"],
            source: { kind: "seed" },
          },
          {
            id: "case-aircon-confirm-train",
            title: "Explicit booking confirmation",
            split: "train",
            type: "booking",
            language: "English",
            inputConversation: {
              messages: [msg("case-aircon-confirm-train-1", "patient", "Saturday 10 AM works.")],
            },
            expectedHumanOutput:
              "Please confirm Saturday 10:00-12:00 at Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya before I create the booking.",
            criterionIds: ["crit-aircon-confirm"],
            source: { kind: "seed" },
          },
          {
            id: "case-aircon-rate-card-holdout",
            title: "Discount request holdout",
            split: "holdout",
            type: "general",
            language: "English",
            inputConversation: {
              messages: [
                msg(
                  "case-aircon-rate-card-holdout-1",
                  "patient",
                  "Can you discount a normal service?",
                ),
              ],
            },
            expectedHumanOutput:
              "The fixed general-service price is RM99 per supported unit; I cannot add a discount.",
            criterionIds: ["crit-aircon-price"],
            source: { kind: "seed" },
          },
          {
            id: "case-aircon-selection-holdout",
            title: "Malay combined-symptom holdout",
            split: "holdout",
            type: "general",
            language: "Malay",
            inputConversation: {
              messages: [
                msg(
                  "case-aircon-selection-holdout-1",
                  "patient",
                  "Aircond wall unit 1.0 HP kurang sejuk dan berbau hapak.",
                ),
              ],
            },
            expectedHumanOutput:
              "Untuk kurang sejuk dan bau hapak, saya syorkan chemical wash RM160 untuk satu unit yang disokong.",
            criterionIds: ["crit-aircon-selection", "crit-aircon-price"],
            source: { kind: "seed" },
          },
        ],
        suiteSnapshots: [],
        runHistory: [],
      },
    ],
    selections: {
      conversationId: "convo-aircon-booking",
      playbookFileId: "file-aircon-rate-card",
      evalDatasetId: "dataset-aircon-ops",
    },
  };
}

export function createCanonicalSeed(): AppState {
  return cloneState(buildSeedState());
}

export function resetDemo(_state: AppState): MutationResult {
  return ok(createCanonicalSeed());
}

function inferSeedCaseType(caseId: string, title: string): EvalCaseType {
  if (caseId.includes("emergency") || title.toLowerCase().includes("emergency")) {
    return "emergency_triage";
  }
  if (caseId.includes("booking") || title.toLowerCase().includes("booking")) {
    return "booking";
  }
  if (caseId.includes("prescription") || title.toLowerCase().includes("prescription")) {
    return "prescription";
  }
  if (caseId.includes("lab") || title.toLowerCase().includes("lab")) {
    return "lab_follow_up";
  }
  if (title.toLowerCase().includes("triage")) {
    return "emergency_triage";
  }
  return "general";
}

export { inferSeedCaseType };
