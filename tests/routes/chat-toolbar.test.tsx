import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatToolbar } from "../../src/routes/chat/chat-toolbar";

describe("ChatToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps search, view, filter, and simulation reachable from the compact tools menu", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    const onQueryChange = vi.fn();
    const onSimulate = vi.fn();
    const onViewChange = vi.fn();

    render(
      <ChatToolbar
        count={5}
        filter="all"
        onFilterChange={onFilterChange}
        onQueryChange={onQueryChange}
        onRefresh={vi.fn()}
        onSimulate={onSimulate}
        onViewChange={onViewChange}
        query=""
        refreshing={false}
        syncPending={false}
        view="inbox"
      />,
    );

    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    const menu = screen.getByRole("menu");
    const search = within(menu).getByRole("searchbox", { name: "Search conversations" });

    await user.type(search, "Aina");
    expect(onQueryChange).toHaveBeenLastCalledWith("A");

    await user.click(within(menu).getByRole("menuitemradio", { name: "Schedule" }));
    expect(onViewChange).toHaveBeenCalledWith("schedule");

    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    const reopenedMenu = screen.getByRole("menu");
    await user.click(within(reopenedMenu).getByRole("menuitemradio", { name: "Autonomous agent" }));
    expect(onFilterChange).toHaveBeenCalledWith("ai_handling");

    await user.click(screen.getByRole("button", { name: "More chat actions" }));
    await user.click(within(screen.getByRole("menu")).getByText("Simulate Customer"));
    expect(onSimulate).toHaveBeenCalledTimes(1);
  });
});
