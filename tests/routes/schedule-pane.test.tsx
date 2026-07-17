import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanonicalSeed } from "../../src/domain";
import { SchedulePane } from "../../src/routes/chat/schedule-pane";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Schedule pane calendar connection", () => {
  it("offers an in-app authorization flow when Google Calendar needs connection", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          calendarId: "primary",
          configured: true,
          mode: "demo",
          status: "disconnected",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=demo",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const state = createCanonicalSeed();

    render(
      <SchedulePane
        compact={false}
        conversations={state.conversations}
        fixtureTime={state.fixtureTime}
        onCreateBooking={vi.fn()}
        onEditBooking={vi.fn()}
        onOpenConversation={vi.fn()}
        onSendCalendar={vi.fn()}
      />,
    );

    expect(await screen.findByText("Google Calendar needs connection")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    await user.type(screen.getByLabelText("Calendar admin token"), "admin-secret");
    await user.click(screen.getByRole("button", { name: "Get authorization link" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/admin/calendar/google/connect",
        expect.objectContaining({
          method: "POST",
          headers: { "x-kaunter-admin-token": "admin-secret" },
        }),
      ),
    );
    expect(
      await screen.findByRole("link", { name: "Continue with Google" }),
    ).toHaveAttribute(
      "href",
      "https://accounts.google.com/o/oauth2/v2/auth?state=demo",
    );
    expect(screen.getByLabelText("Calendar admin token")).toHaveValue("");
  });

  it("groups UTC booking instants under their Malaysian calendar date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          calendarId: null,
          configured: false,
          mode: "demo",
          status: "disabled",
        }),
      ),
    );
    const state = createCanonicalSeed();
    state.conversations[0] = {
      ...state.conversations[0]!,
      booking: {
        reason: "Overnight service",
        revision: 1,
        slotIso: "2026-07-17T18:00:00.000Z",
        status: "approved",
      },
    };

    render(
      <SchedulePane
        compact={false}
        conversations={state.conversations}
        fixtureTime={state.fixtureTime}
        onCreateBooking={vi.fn()}
        onEditBooking={vi.fn()}
        onOpenConversation={vi.fn()}
        onSendCalendar={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /18 Jul.*1 booking/i }),
    ).toBeInTheDocument();
  });
});
