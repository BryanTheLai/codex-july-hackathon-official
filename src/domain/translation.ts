type TranslationLanguage = "English" | "Malay" | "Mandarin";

export type FixtureTranslationResult =
  | { ok: true; language: TranslationLanguage; text: string }
  | { ok: false; error: string };

const FIXTURE_TRANSLATIONS: Record<Exclude<TranslationLanguage, "English">, Record<string, string>> = {
  Malay: {
    "Bring your identity card fifteen minutes before arrival.":
      "Bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
    "I would like to renew my blood pressure medicine.":
      "Saya ingin memperbaharui ubat tekanan darah saya.",
    "Please bring your identity card fifteen minutes before arrival.":
      "Sila bawa kad pengenalan anda lima belas minit sebelum ketibaan.",
    "Please seek urgent care now.": "Sila dapatkan rawatan kecemasan sekarang.",
    "We will check your slot and send confirmation.":
      "Kami akan semak slot anda dan hantar pengesahan.",
  },
  Mandarin: {
    "Bring your identity card fifteen minutes before arrival.":
      "请在抵达前十五分钟携带身份证。",
    "I would like to renew my blood pressure medicine.": "我想续开降压药。",
    "Please bring your identity card fifteen minutes before arrival.":
      "请在抵达前十五分钟携带身份证。",
    "Please seek urgent care now.": "请立即前往急诊就医。",
    "We will check your slot and send confirmation.": "我们会确认时段并发送确认信息。",
  },
};

export function translateFixtureReply(
  sourceText: string,
  language: TranslationLanguage,
): FixtureTranslationResult {
  const normalized = sourceText.trim();
  if (language === "English") {
    return { language, ok: true, text: normalized };
  }
  const translated = FIXTURE_TRANSLATIONS[language][normalized];
  if (!translated) {
    return {
      error: "Synthetic translation is unavailable for this phrase.",
      ok: false,
    };
  }
  return { language, ok: true, text: translated };
}
