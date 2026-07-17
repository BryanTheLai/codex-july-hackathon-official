export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur" as const;
export const MALAYSIA_UTC_OFFSET = "+08:00" as const;

type MalaysiaDateTimeParts = {
  day: string;
  hour: string;
  minute: string;
  month: string;
  year: string;
};

function malaysiaDateTimeParts(iso: string): MalaysiaDateTimeParts {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Date-time must be a valid ISO instant");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: MALAYSIA_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    month: value("month"),
    year: value("year"),
  };
}

export function malaysiaCalendarDate(iso: string): string {
  const parts = malaysiaDateTimeParts(iso);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function toMalaysiaDateTimeLocal(iso: string): string {
  const parts = malaysiaDateTimeParts(iso);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromMalaysiaDateTimeLocal(value: string): string {
  return value ? `${value}:00${MALAYSIA_UTC_OFFSET}` : "";
}

export function nextMalaysiaCalendarDate(value: string): string {
  const noon = new Date(`${value}T12:00:00${MALAYSIA_UTC_OFFSET}`);
  if (Number.isNaN(noon.valueOf())) {
    throw new Error("Date must use YYYY-MM-DD");
  }
  return malaysiaCalendarDate(
    new Date(noon.valueOf() + 86_400_000).toISOString(),
  );
}

export function sameInstant(left: string, right: string): boolean {
  return new Date(left).valueOf() === new Date(right).valueOf();
}
