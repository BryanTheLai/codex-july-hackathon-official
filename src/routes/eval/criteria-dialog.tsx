import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Edit3, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  Criterion,
  CriterionEditInput,
  CriterionInput,
  EvalDataset,
  MutationResult,
} from "../../domain";

export function CriteriaDialog({
  dataset,
  open,
  onAdd,
  onDelete,
  onEdit,
  onOpenChange,
}: {
  dataset: EvalDataset;
  open: boolean;
  onAdd: (input: CriterionInput) => MutationResult;
  onDelete: (criterionId: string) => MutationResult;
  onEdit: (criterionId: string, input: CriterionEditInput) => MutationResult;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<Criterion | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [instruction, setInstruction] = useState("");
  const [required, setRequired] = useState(false);
  const [goodExample, setGoodExample] = useState("");
  const [badExample, setBadExample] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setFormOpen(false);
      setEditing(null);
      setError("");
    }
  }, [open]);

  const start = (criterion?: Criterion) => {
    setEditing(criterion ?? null);
    setLabel(criterion?.label ?? "");
    setInstruction(criterion?.instruction ?? "");
    setRequired(criterion?.required ?? false);
    setGoodExample(criterion?.examples?.good ?? "");
    setBadExample(criterion?.examples?.bad ?? "");
    setAdvancedOpen(Boolean(criterion?.examples?.good || criterion?.examples?.bad));
    setError("");
    setFormOpen(true);
  };

  const save = () => {
    const input: CriterionInput = {
      label,
      instruction,
      required,
      examples: {
        good: goodExample,
        bad: badExample,
      },
    };
    const result = editing ? onEdit(editing.id, input) : onAdd(input);
    if (result.ok) {
      setFormOpen(false);
      setEditing(null);
      setError("");
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="eval-dialog__overlay" />
        <Dialog.Content className="eval-dialog__content">
          <Dialog.Title className="eval-dialog__title">Scoring rules</Dialog.Title>
          <Dialog.Description className="eval-dialog__description">
            Give the judge a plain-language description of what a good reply should do. Equivalent
            wording is allowed.
          </Dialog.Description>
          <div className="criteria-list">
            {dataset.criteria.length === 0 ? (
              <p>No scoring rules in this dataset.</p>
            ) : (
              dataset.criteria.map((criterion) => {
                const usedBy = dataset.cases.filter(
                  (evalCase) =>
                    evalCase.criterionIds.length === 0 ||
                    evalCase.criterionIds.includes(criterion.id),
                ).length;
                return (
                  <div className="criteria-row" key={criterion.id}>
                    <div>
                      <strong>{criterion.label}</strong>
                      <span>
                        {criterion.required ? "Required to pass" : "Quality score"} | v
                        {criterion.version} | Used by {usedBy} {usedBy === 1 ? "test" : "tests"}
                      </span>
                      <span>{criterion.instruction}</span>
                    </div>
                    <button aria-label={`Edit ${criterion.label}`} onClick={() => start(criterion)} type="button">
                      <Edit3 aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`Delete ${criterion.label}`}
                      onClick={() => {
                        const result = onDelete(criterion.id);
                        setError(result.ok ? "" : result.error);
                      }}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {formOpen ? (
            <div className="criteria-form">
              <label>
                Rule name
                <input aria-label="Rule name" onChange={(event) => setLabel(event.target.value)} value={label} />
              </label>
              <label>
                What should a good reply do?
                <textarea
                  aria-label="What should a good reply do?"
                  onChange={(event) => setInstruction(event.target.value)}
                  rows={4}
                  value={instruction}
                />
              </label>
              <label className="criteria-form__check">
                <input
                  checked={required}
                  onChange={(event) => setRequired(event.target.checked)}
                  type="checkbox"
                />
                Required to pass
              </label>
              <button
                aria-expanded={advancedOpen}
                className="criteria-form__advanced"
                onClick={() => setAdvancedOpen((current) => !current)}
                type="button"
              >
                <ChevronDown aria-hidden="true" size={14} />
                Advanced
              </button>
              {advancedOpen ? (
                <div className="criteria-form__examples">
                  <label>
                    Good example
                    <textarea
                      aria-label="Good example"
                      onChange={(event) => setGoodExample(event.target.value)}
                      rows={2}
                      value={goodExample}
                    />
                  </label>
                  <label>
                    Bad example
                    <textarea
                      aria-label="Bad example"
                      onChange={(event) => setBadExample(event.target.value)}
                      rows={2}
                      value={badExample}
                    />
                  </label>
                </div>
              ) : null}
              <button className="eval-button eval-button--primary" onClick={save} type="button">
                Save rule
              </button>
            </div>
          ) : (
            <button className="eval-button" onClick={() => start()} type="button">
              <Plus aria-hidden="true" size={14} />
              Add scoring rule
            </button>
          )}
          {error ? <p className="eval-inline-error" role="alert">{error}</p> : null}
          <div className="eval-dialog__actions">
            <Dialog.Close asChild>
              <button className="eval-button" type="button">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
