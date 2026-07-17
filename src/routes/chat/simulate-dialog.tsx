import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import type { MutationResult, SimulateScenario } from "../../domain";

const SCENARIOS: Array<{
  value: SimulateScenario;
  label: string;
  description: string;
}> = [
  {
    value: "aircon_malay_booking",
    label: "Malay aircon booking",
    description: "Adds a Malay WhatsApp fixture for a routine general-service booking.",
  },
  {
    value: "aircon_package_complaint",
    label: "Package selection complaint",
    description: "Adds a fixture where the customer disputes the quoted service package.",
  },
];

export function SimulateDialog({
  open,
  onOpenChange,
  onSimulate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSimulate: (scenario: SimulateScenario) => MutationResult;
}) {
  const [scenario, setScenario] = useState<SimulateScenario>("aircon_malay_booking");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setScenario("aircon_malay_booking");
      setRunning(false);
      setError("");
    }
  }, [open]);

  const submit = () => {
    if (running) {
      return;
    }
    setRunning(true);
    const result = onSimulate(scenario);
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
      setRunning(false);
    }
  };

  const selected = SCENARIOS.find((item) => item.value === scenario)!;

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="chat-dialog__overlay" />
        <Dialog.Content className="chat-dialog__content">
          <Dialog.Title className="chat-dialog__title">Simulate Customer</Dialog.Title>
          <Dialog.Description className="chat-dialog__description">
            Add one deterministic synthetic conversation. No customer, job site, or external service
            is contacted.
          </Dialog.Description>
          <label className="chat-dialog__field">
            Scenario
            <select
              aria-label="Scenario"
              disabled={running}
              onChange={(event) => setScenario(event.target.value as SimulateScenario)}
              value={scenario}
            >
              {SCENARIOS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="chat-dialog__scenario">{selected.description}</p>
          {error ? (
            <p className="chat-inline-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="chat-dialog__actions">
            <Dialog.Close asChild>
              <button className="chat-button" disabled={running} type="button">
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="chat-button chat-button--primary"
              disabled={running}
              onClick={submit}
              type="button"
            >
              {running ? "Adding synthetic customer" : "Add synthetic customer"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
