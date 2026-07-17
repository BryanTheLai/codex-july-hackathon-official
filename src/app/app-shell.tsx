import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Bot, FlaskConical, MessagesSquare, RotateCcw, WandSparkles } from "lucide-react";
import { useId, useState } from "react";
import { NavLink, Outlet } from "react-router";

import { useAppStore } from "../store/app-store-context";

const SHELL_NAV = [
  { to: "/", end: true, label: "Chat Control", Icon: MessagesSquare },
  { to: "/knowledge", end: false, label: "Knowledge", Icon: WandSparkles },
  { to: "/eval", end: false, label: "Evals", Icon: FlaskConical },
] as const;

const FACTORY_RESET_CONFIRMATION = "RESET";

function ShellNavLink({
  to,
  end,
  label,
  Icon,
}: {
  to: string;
  end: boolean;
  label: string;
  Icon: typeof MessagesSquare;
}) {
  return (
    <NavLink
      aria-label={label}
      className="app-shell__nav-link"
      end={end}
      title={label}
      to={to}
    >
      <Icon aria-hidden="true" className="app-shell__nav-icon" size={18} strokeWidth={1.75} />
      <span className="app-shell__nav-label">{label}</span>
    </NavLink>
  );
}

function ResetDialog() {
  const resetDemo = useAppStore((store) => store.resetDemo);
  const confirmationInputId = useId();
  const [confirmation, setConfirmation] = useState("");
  const canConfirm = confirmation.trim() === FACTORY_RESET_CONFIRMATION;

  return (
    <AlertDialog.Root
      onOpenChange={(open) => {
        if (!open) {
          setConfirmation("");
        }
      }}
    >
      <AlertDialog.Trigger asChild>
        <button
          aria-label="Factory reset"
          className="app-shell__reset"
          title="Factory reset"
          type="button"
        >
          <RotateCcw aria-hidden="true" className="app-shell__reset-icon" size={18} strokeWidth={1.75} />
          <span className="app-shell__reset-label">Reset</span>
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="shell-dialog__overlay" />
        <AlertDialog.Content className="shell-dialog__content">
          <AlertDialog.Title className="shell-dialog__title">
            Factory reset demo
          </AlertDialog.Title>
          <AlertDialog.Description className="shell-dialog__description">
            This permanently deletes all demo activity and restores the compiled canonical seed.
            OAuth and environment credentials are preserved. Deleted data includes all workspace
            conversations and chat history; Knowledge edits, candidates, corrections, and release
            state; Eval datasets, run history, suites, and imported case evidence; Telegram events,
            deliveries, and speech artifacts; calendar deliveries, mappings, and outbox jobs; and
            generated voice artifacts plus tracked Google Calendar events. Type{" "}
            <strong>{FACTORY_RESET_CONFIRMATION}</strong> below to confirm.
          </AlertDialog.Description>
          <div className="shell-dialog__field">
            <label className="shell-dialog__field-label" htmlFor={confirmationInputId}>
              Type RESET to confirm
            </label>
            <input
              autoComplete="off"
              className="shell-dialog__input"
              id={confirmationInputId}
              onChange={(event) => setConfirmation(event.target.value)}
              spellCheck={false}
              type="text"
              value={confirmation}
            />
          </div>
          <div className="shell-dialog__actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="shell-dialog__button">
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                className="shell-dialog__button shell-dialog__button--confirm"
                disabled={!canConfirm}
                type="button"
                onClick={() => {
                  void resetDemo();
                  setConfirmation("");
                }}
              >
                Factory reset
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function AppShell() {
  const lastFeedback = useAppStore((store) => store.lastFeedback);

  return (
    <div className="app-root">
      <header className="app-shell">
        <span className="app-shell__brand">
          <span className="app-shell__brand-full">KaunterAI</span>
          <span aria-hidden="true" className="app-shell__brand-compact">
            K
          </span>
        </span>
        <nav aria-label="Primary" className="app-shell__nav">
          {SHELL_NAV.map((item) => (
            <ShellNavLink
              key={item.to}
              end={item.end}
              Icon={item.Icon}
              label={item.label}
              to={item.to}
            />
          ))}
        </nav>
        <span className="app-shell__demo">
          <Bot aria-hidden="true" size={15} strokeWidth={1.8} />
          <span className="app-shell__demo-full">Synthetic Demo</span>
          <span className="app-shell__demo-compact">Demo</span>
        </span>
        <ResetDialog />
      </header>
      <main className="app-main">
        <div aria-live="polite" className="app-feedback" role="status">
          {lastFeedback}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
