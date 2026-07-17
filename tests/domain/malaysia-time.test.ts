import { describe, expect, it } from "vitest";

import {
  fromMalaysiaDateTimeLocal,
  MALAYSIA_TIME_ZONE,
  malaysiaCalendarDate,
  nextMalaysiaCalendarDate,
  toMalaysiaDateTimeLocal,
} from "../../src/domain/malaysia-time";

describe("Malaysia time", () => {
  it("maps an instant across UTC midnight to its Malaysian calendar date", () => {
    expect(MALAYSIA_TIME_ZONE).toBe("Asia/Kuala_Lumpur");
    expect(malaysiaCalendarDate("2026-07-17T18:00:00.000Z")).toBe(
      "2026-07-18",
    );
  });

  it("renders datetime-local values in Malaysia time regardless of host timezone", () => {
    expect(toMalaysiaDateTimeLocal("2026-07-17T18:30:00.000Z")).toBe(
      "2026-07-18T02:30",
    );
  });

  it("round-trips a Malaysian wall-clock input with an explicit UTC+8 offset", () => {
    expect(fromMalaysiaDateTimeLocal("2026-07-18T02:30")).toBe(
      "2026-07-18T02:30:00+08:00",
    );
  });

  it("advances Malaysian calendar dates across month boundaries", () => {
    expect(nextMalaysiaCalendarDate("2026-07-31")).toBe("2026-08-01");
  });
});
