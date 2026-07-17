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
            "I want a general service for one 1.5 HP wall-mounted air conditioner in SS2.",
            "Malay",
          ),
          msg(
            "book-2",
            "synthetic_agent",
            "Servis biasa ialah RM99 untuk setiap unit. Tarikh dan masa mana yang anda mahu?",
            "General service is RM99 per unit. Which date and time do you prefer?",
            "Malay",
          ),
          msg(
            "book-3",
            "patient",
            "Sabtu pukul 10 pagi boleh? Alamat saya di SS2.",
            "Would Saturday at 10 AM work? My address is in SS2.",
            "Malay",
          ),
          msg(
            "book-4",
            "synthetic_agent",
            "Boleh. Sila beri alamat penuh dan sahkan slot Sabtu pukul 10 pagi sebelum saya buat tempahan.",
            "Yes. Please provide the full address and confirm Saturday at 10 AM before I create the booking.",
            "Malay",
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
            undefined,
            "English",
          ),
          msg(
            "complaint-2",
            "synthetic_agent",
            "General service is RM99 per unit.",
            undefined,
            "English",
          ),
          msg(
            "complaint-3",
            "patient",
            "ei i thought rm160 for chemical wash??",
            undefined,
            "English",
          ),
        ],
      }),
      conversation({
        id: "convo-aircon-resolved",
        patient: {
          name: "Mei Demo",
          phone: "+601100000103",
          medicalRecordNumber: "",
          preferredLanguage: "Mandarin",
        },
        channel: "WhatsApp",
        urgency: "routine",
        agentMode: "staff_only",
        workflowStatus: "resolved",
        resolvedAt: FIXTURE_TIME_ISO,
        labels: ["aircon", "resolved"],
        messages: [
          msg(
            "resolved-1",
            "patient",
            "你好，我想预约一台1.5匹壁挂式空调的普通清洗。",
            "Hello, I would like to book a general service for one 1.5 HP wall-mounted air conditioner.",
            "Mandarin",
          ),
          msg(
            "resolved-2",
            "staff",
            "普通清洗每台RM99。请问您想预约哪一天？",
            "General service is RM99 per unit. Which day would you prefer?",
            "Mandarin",
          ),
          msg(
            "resolved-3",
            "patient",
            "这周六上午可以吗？地址在SS2。",
            "Would Saturday morning work? The address is in SS2.",
            "Mandarin",
          ),
          msg(
            "resolved-4",
            "staff",
            "可以，已经为您安排好了。",
            "Yes, it has been arranged for you.",
            "Mandarin",
          ),
          msg(
            "resolved-5",
            "patient",
            "谢谢，服务已经完成了。",
            "Thank you, the service has been completed.",
            "Mandarin",
          ),
          msg(
            "resolved-6",
            "staff",
            "不客气，这个工单已关闭。",
            "You are welcome. This job has been closed.",
            "Mandarin",
          ),
          msg("resolved-7", "system", "Conversation resolved by staff."),
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
            knowledgeFileIds: ["file-aircon-rate-card"],
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
            knowledgeFileIds: ["file-aircon-service-selection"],
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
            knowledgeFileIds: ["file-aircon-booking"],
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
