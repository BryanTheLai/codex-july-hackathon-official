export const SCHEMA_VERSION = 4 as const;

export const AGENT_MODES = ["synthetic_agent", "staff_only"] as const;
export const WORKFLOW_STATUSES = ["in_progress", "resolved"] as const;
export const URGENCY_LEVELS = ["emergency", "routine"] as const;
export const MESSAGE_ROLES = ["patient", "staff", "synthetic_agent", "system"] as const;
export const BOOKING_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export const BOOKING_NOTIFICATION_EVENTS = [
  "confirmed",
  "request_updated",
  "request_rejected",
  "rescheduled",
  "details_updated",
  "cancelled",
] as const;
export const CORRECTION_STATUSES = ["pending", "approved", "rejected"] as const;
export const EVAL_SPLITS = ["train", "holdout"] as const;
export const EVAL_CASE_TYPES = [
  "emergency_triage",
  "booking",
  "prescription",
  "lab_follow_up",
  "general",
] as const;
export const EVAL_CASE_SOURCE_KINDS = [
  "seed",
  "hitl",
  "manual",
  "autonomous_feedback",
] as const;
export const SEED_EVAL_CASE_IDS = [
  "case-emergency-train",
  "case-booking-train",
  "case-prescription-train",
  "case-hours-holdout",
  "case-lab-holdout",
] as const;
export const LEGACY_SEED_EVAL_CASE_IDS = [
  "case-malay-holdout",
  "case-mandarin-holdout",
] as const;
export const CRITERION_VERDICTS = ["pass", "fail", "uncertain"] as const;
export const EVAL_VERDICTS = ["pass", "fail", "needs_review"] as const;
export const SIMULATE_SCENARIOS = [
  "emergency_chest_pain",
  "malay_booking",
  "mandarin_voice",
] as const;
