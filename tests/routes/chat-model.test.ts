import { describe, expect, it } from "vitest";

import { scheduleDays } from "../../src/routes/chat/chat-model";

describe("chat schedule dates", () => {
  it("anchors the demo week to the Malaysian date of the fixture instant", () => {
    expect(scheduleDays("2026-07-17T18:00:00.000Z")[0]?.isoDate).toBe(
      "2026-07-18",
    );
  });
});
