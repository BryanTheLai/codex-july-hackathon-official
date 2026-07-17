insert into public.demo_seed_templates (
  seed_key,
  schema_version,
  source_state,
  state,
  compiled_at
) values (
  'msme-aircon-v1',
  4,
  $json${
  "schemaVersion": 4,
  "fixtureTime": "2026-07-18T08:00:00+08:00",
  "conversations": [
    {
      "id": "convo-aircon-booking",
      "patient": {
        "name": "Aina Demo",
        "phone": "+601100000101",
        "medicalRecordNumber": "",
        "preferredLanguage": "Malay"
      },
      "channel": "Telegram",
      "urgency": "routine",
      "agentMode": "synthetic_agent",
      "workflowStatus": "in_progress",
      "resolvedAt": null,
      "labels": ["aircon", "booking", "general-service"],
      "messages": [
        {
          "id": "book-1",
          "role": "patient",
          "text": "Saya nak servis biasa untuk satu aircond wall unit 1.5 HP di SS2.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        },
        {
          "id": "book-2",
          "role": "synthetic_agent",
          "text": "General service is RM99 per unit. Which date and time do you prefer?",
          "sentAt": "2026-07-18T08:00:00+08:00"
        }
      ]
    },
    {
      "id": "convo-aircon-complaint",
      "patient": {
        "name": "Farid Demo",
        "phone": "+601100000102",
        "medicalRecordNumber": "",
        "preferredLanguage": "English"
      },
      "channel": "Telegram",
      "urgency": "routine",
      "agentMode": "synthetic_agent",
      "workflowStatus": "in_progress",
      "resolvedAt": null,
      "labels": ["aircon", "package-selection"],
      "messages": [
        {
          "id": "complaint-1",
          "role": "patient",
          "text": "My 1.5 HP wall unit is not cooling and smells musty.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        },
        {
          "id": "complaint-2",
          "role": "synthetic_agent",
          "text": "General service is RM99 per unit.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        },
        {
          "id": "complaint-3",
          "role": "patient",
          "text": "That package is wrong. I said it is not cooling and smells musty.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        }
      ]
    },
    {
      "id": "convo-aircon-resolved",
      "patient": {
        "name": "Mei Demo",
        "phone": "+601100000103",
        "medicalRecordNumber": "",
        "preferredLanguage": "Malay"
      },
      "channel": "Telegram",
      "urgency": "routine",
      "agentMode": "staff_only",
      "workflowStatus": "resolved",
      "resolvedAt": "2026-07-18T08:00:00+08:00",
      "labels": ["aircon", "resolved"],
      "messages": [
        {
          "id": "resolved-1",
          "role": "patient",
          "text": "Terima kasih, servis sudah selesai.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        },
        {
          "id": "resolved-2",
          "role": "staff",
          "text": "Sama-sama. Job ini ditutup.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        },
        {
          "id": "resolved-3",
          "role": "system",
          "text": "Conversation resolved by staff.",
          "sentAt": "2026-07-18T08:00:00+08:00"
        }
      ]
    }
  ],
  "playbookFolders": ["playbooks", "playbooks/data"],
  "playbookFiles": [
    {
      "id": "file-aircon-rate-card",
      "path": "playbooks/aircon-rate-card.md",
      "title": "Aircon rate card",
      "savedContent": "# Aircon rate card\n\n- Supported scope: wall-mounted 1.0-1.5 HP units in the demo service area.\n- General service: RM99 per unit.\n- Chemical wash: RM160 per unit.\n- Prices are fixed. Do not invent discounts, parts, gas, or repair quotes.\n",
      "updatedAt": "2026-07-18T08:00:00+08:00",
      "protected": true
    },
    {
      "id": "file-aircon-booking",
      "path": "playbooks/aircon-booking.md",
      "title": "Aircon booking",
      "savedContent": "# Aircon booking\n\nCollect symptoms, unit type, horsepower, unit count, area, preferred slot, and\naddress. Offer only server-returned slots. Create the booking only after the\ncustomer explicitly confirms one slot and the address.\n",
      "updatedAt": "2026-07-18T08:00:00+08:00",
      "protected": true
    },
    {
      "id": "file-aircon-service-selection",
      "path": "playbooks/aircon-service-selection.md",
      "title": "Aircon service selection",
      "savedContent": "# Aircon service selection\n\nRoutine cleaning uses the RM99 general service.\nFor poor cooling and a musty smell, quote the RM99 general service.\nDo not diagnose parts or promise a repair outcome.\n",
      "updatedAt": "2026-07-18T08:00:00+08:00",
      "protected": true
    }
  ],
  "corrections": [],
  "evalDatasets": [
    {
      "id": "dataset-aircon-ops",
      "name": "Aircon service operations",
      "protected": true,
      "candidateVersion": 1,
      "criteria": [
        {
          "id": "crit-aircon-price",
          "label": "Fixed rate card",
          "instruction": "Use RM99 general service and RM160 chemical wash; do not invent discounts",
          "required": true,
          "version": 1,
          "knowledgeFileIds": ["file-aircon-rate-card"],
          "examples": {
            "good": "General service is RM99.",
            "bad": "I can discount it to RM80."
          }
        },
        {
          "id": "crit-aircon-selection",
          "label": "Package selection",
          "instruction": "Poor cooling plus musty smell requires chemical wash",
          "required": true,
          "version": 1,
          "caseTypes": ["general"],
          "knowledgeFileIds": ["file-aircon-service-selection"],
          "examples": {
            "good": "Chemical wash is RM160.",
            "bad": "General service is RM99."
          }
        },
        {
          "id": "crit-aircon-confirm",
          "label": "Explicit booking confirmation",
          "instruction": "Do not create or claim a booking before explicit slot/address confirmation",
          "required": true,
          "version": 1,
          "caseTypes": ["booking"],
          "knowledgeFileIds": ["file-aircon-booking"],
          "examples": {
            "good": "Please confirm the slot and address.",
            "bad": "Your booking is confirmed."
          }
        }
      ],
      "cases": [
        {
          "id": "case-aircon-rate-card-train",
          "title": "Malay general-service price",
          "split": "train",
          "type": "general",
          "language": "Malay",
          "inputConversation": {
            "messages": [
              {
                "id": "case-aircon-rate-card-train-1",
                "role": "patient",
                "text": "Berapa servis biasa untuk wall unit 1.5 HP?",
                "sentAt": "2026-07-18T08:00:00+08:00"
              }
            ]
          },
          "expectedHumanOutput": "General service is RM99 per supported unit.",
          "criterionIds": ["crit-aircon-price"],
          "source": { "kind": "seed" }
        },
        {
          "id": "case-aircon-selection-train",
          "title": "Combined symptoms need chemical wash",
          "split": "train",
          "type": "general",
          "language": "English",
          "inputConversation": {
            "messages": [
              {
                "id": "case-aircon-selection-train-1",
                "role": "patient",
                "text": "My 1.5 HP wall unit is not cooling and smells musty.",
                "sentAt": "2026-07-18T08:00:00+08:00"
              }
            ]
          },
          "expectedHumanOutput": "For poor cooling and a musty smell, I recommend the RM160 chemical wash for one supported unit.",
          "criterionIds": ["crit-aircon-selection", "crit-aircon-price"],
          "source": { "kind": "seed" }
        },
        {
          "id": "case-aircon-confirm-train",
          "title": "Explicit booking confirmation",
          "split": "train",
          "type": "booking",
          "language": "English",
          "inputConversation": {
            "messages": [
              {
                "id": "case-aircon-confirm-train-1",
                "role": "patient",
                "text": "Saturday 10 AM works.",
                "sentAt": "2026-07-18T08:00:00+08:00"
              }
            ]
          },
          "expectedHumanOutput": "Please confirm Saturday 10:00-12:00 at Unit DEMO-12, Jalan SS2 Demo, 47300 Petaling Jaya before I create the booking.",
          "criterionIds": ["crit-aircon-confirm"],
          "source": { "kind": "seed" }
        },
        {
          "id": "case-aircon-rate-card-holdout",
          "title": "Discount request holdout",
          "split": "holdout",
          "type": "general",
          "language": "English",
          "inputConversation": {
            "messages": [
              {
                "id": "case-aircon-rate-card-holdout-1",
                "role": "patient",
                "text": "Can you discount a normal service?",
                "sentAt": "2026-07-18T08:00:00+08:00"
              }
            ]
          },
          "expectedHumanOutput": "The fixed general-service price is RM99 per supported unit; I cannot add a discount.",
          "criterionIds": ["crit-aircon-price"],
          "source": { "kind": "seed" }
        },
        {
          "id": "case-aircon-selection-holdout",
          "title": "Malay combined-symptom holdout",
          "split": "holdout",
          "type": "general",
          "language": "Malay",
          "inputConversation": {
            "messages": [
              {
                "id": "case-aircon-selection-holdout-1",
                "role": "patient",
                "text": "Aircond wall unit 1.0 HP kurang sejuk dan berbau hapak.",
                "sentAt": "2026-07-18T08:00:00+08:00"
              }
            ]
          },
          "expectedHumanOutput": "Untuk kurang sejuk dan bau hapak, saya syorkan chemical wash RM160 untuk satu unit yang disokong.",
          "criterionIds": ["crit-aircon-selection", "crit-aircon-price"],
          "source": { "kind": "seed" }
        }
      ],
      "suiteSnapshots": [],
      "runHistory": []
    }
  ]
}$json$::jsonb,
  null,
  null
)
on conflict (seed_key) do update
set
  schema_version = excluded.schema_version,
  source_state = excluded.source_state,
  updated_at = now();
