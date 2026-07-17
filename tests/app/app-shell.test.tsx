import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, beforeEach } from "vitest";

import { AppShell } from "../../src/app/app-shell";
import { RouteLoading } from "../../src/app/route-loading";
import { createAppStore } from "../../src/store/use-app-store";
import { AppStoreProvider, useAppStoreApi } from "../../src/store/app-store-context";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function TestHarness({ children }: { children: React.ReactNode }) {
  const store = createAppStore(new MemoryStorage());
  return <AppStoreProvider store={store}>{children}</AppStoreProvider>;
}

function RoutedShell() {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<div>Chat workbench</div>} />
          <Route path="dream" element={<div>Dream workbench</div>} />
          <Route path="eval" element={<div>Eval workbench</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function SeedMutator() {
  const api = useAppStoreApi();
  return (
    <button
      type="button"
      onClick={() => {
        const convoId = api.getState().state.conversations[0]!.id;
        api.getState().sendStaffReply({
          conversationId: convoId,
          text: "Shell mutation",
          kind: "reply",
        });
      }}
    >
      Mutate seed
    </button>
  );
}

describe("app shell", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders exactly three primary nav links with accessible names and paths", () => {
    render(
      <TestHarness>
        <RoutedShell />
      </TestHarness>,
    );

    const nav = screen.getByRole("navigation", { name: /primary/i });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(3);

    expect(links[0]).toHaveAccessibleName("Chat Control");
    expect(links[0]).toHaveAttribute("href", "/");
    expect(links[1]).toHaveAccessibleName("Knowledge");
    expect(links[1]).toHaveAttribute("href", "/dream");
    expect(links[2]).toHaveAccessibleName("Evals");
    expect(links[2]).toHaveAttribute("href", "/eval");
  });

  it("shows the Synthetic Demo label", () => {
    render(
      <TestHarness>
        <RoutedShell />
      </TestHarness>,
    );

    expect(screen.getByText("Synthetic Demo")).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
  });

  it("exposes full and compact shell treatments for brand, nav links, demo, and reset", () => {
    render(
      <TestHarness>
        <RoutedShell />
      </TestHarness>,
    );

    expect(screen.getByText("KaunterAI")).toHaveClass("app-shell__brand-full");
    expect(screen.getByText("K")).toHaveClass("app-shell__brand-compact");

    const nav = screen.getByRole("navigation", { name: /primary/i });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(3);

    const navNames = ["Chat Control", "Knowledge", "Evals"] as const;
    links.forEach((link, index) => {
      expect(link).toHaveAccessibleName(navNames[index]);
      expect(link).toHaveAttribute("title", navNames[index]);
      expect(link.querySelector(".app-shell__nav-icon")).toBeTruthy();
      expect(link.querySelector(".app-shell__nav-label")?.textContent).toBe(navNames[index]);
      expect(link.querySelector("[aria-hidden='true']")).toBeTruthy();
    });

    expect(screen.getByText("Synthetic Demo")).toHaveClass("app-shell__demo-full");
    expect(screen.getByText("Demo")).toHaveClass("app-shell__demo-compact");

    const reset = screen.getByRole("button", { name: "Reset Demo" });
    expect(reset.querySelector(".app-shell__reset-icon")).toBeTruthy();
    expect(reset.querySelector("[aria-hidden='true']")).toBeTruthy();
    expect(reset.querySelector(".app-shell__reset-label")?.textContent).toBe("Reset");
  });

  it("fits a 320px shell width without horizontal overflow", () => {
    const { container } = render(
      <TestHarness>
        <RoutedShell />
      </TestHarness>,
    );

    const shell = container.querySelector(".app-shell") as HTMLElement;
    expect(shell).toBeTruthy();
    shell.style.width = "320px";
    shell.style.maxWidth = "320px";
    expect(shell.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("exposes main landmark and route outlet content", () => {
    render(
      <TestHarness>
        <RoutedShell />
      </TestHarness>,
    );

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(within(main).getByText("Chat workbench")).toBeInTheDocument();
  });

  it("announces feedback in a polite live region", async () => {
    const user = userEvent.setup();
    render(
      <TestHarness>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<SeedMutator />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TestHarness>,
    );

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: /mutate seed/i }));
    expect(live.textContent?.length).toBeGreaterThan(0);
  });

  it("announces route loading in a polite live region", () => {
    render(<RouteLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Loading route...");
  });

  it("reset dialog names the effect and confirm restores canonical seed", async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const store = createAppStore(storage);

    render(
      <AppStoreProvider store={store}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<SeedMutator />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppStoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: /mutate seed/i }));
    const convoId = store.getState().state.conversations[0]!.id;
    expect(
      store.getState().state.conversations.find((c) => c.id === convoId)?.messages.at(-1)?.text,
    ).toBe("Shell mutation");

    await user.click(screen.getByRole("button", { name: /reset demo/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/canonical|seed|draft|history|snapshot/i);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      store.getState().state.conversations.find((c) => c.id === convoId)?.messages.at(-1)?.text,
    ).toBe("Shell mutation");

    await user.click(screen.getByRole("button", { name: /reset demo/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    const seed = (await import("../../src/domain")).createCanonicalSeed();
    expect(store.getState().state).toEqual(seed);
    expect(store.getState().lastFeedback).toMatch(/reset/i);
  });
});
