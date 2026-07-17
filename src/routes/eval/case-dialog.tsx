import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import type {
  AddCaseInput,
  CaseEditInput,
  EvalCase,
  EvalCaseType,
  EvalDataset,
  EvalSplit,
  MutationResult,
} from "../../domain";
import { formatCaseType, inputText } from "./eval-model";

const CASE_TYPES: EvalCaseType[] = [
  "emergency_triage",
  "booking",
  "prescription",
  "lab_follow_up",
  "general",
];

export function CaseDialog({
  dataset,
  editing,
  open,
  onAdd,
  onEdit,
  onOpenChange,
}: {
  dataset: EvalDataset;
  editing: EvalCase | null;
  open: boolean;
  onAdd: (input: AddCaseInput) => MutationResult;
  onEdit: (caseId: string, input: CaseEditInput) => MutationResult;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [split, setSplit] = useState<EvalSplit>("train");
  const [type, setType] = useState<EvalCaseType>("general");
  const [language, setLanguage] = useState("English");
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [criterionIds, setCriterionIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(editing?.title ?? "");
    setSplit(editing?.split ?? "train");
    setType(editing?.type ?? "general");
    setLanguage(editing?.language ?? "English");
    setInput(editing ? inputText(editing) : "");
    setExpected(editing?.expectedHumanOutput ?? "");
    setCriterionIds(editing?.criterionIds ?? []);
    setError("");
  }, [editing, open]);

  const submit = () => {
    const result = editing
      ? onEdit(editing.id, {
          criterionIds,
          expectedHumanOutput: expected,
          language,
          split,
          title,
          type,
        })
      : onAdd({
          criterionIds,
          datasetId: dataset.id,
          expectedHumanOutput: expected,
          inputConversation: {
            messages: [
              {
                id: `case-input-${dataset.cases.length + 1}`,
                role: "patient",
                sentAt: "2026-07-08T10:00:00+08:00",
                text: input,
              },
            ],
          },
          language,
          split,
          title,
          type,
        });
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="eval-dialog__overlay" />
        <Dialog.Content className="eval-dialog__content">
          <Dialog.Title className="eval-dialog__title">
            {editing ? "Edit evaluation case" : "New manual test"}
          </Dialog.Title>
          <Dialog.Description className="eval-dialog__description">
            {editing
              ? "Edit the test definition. Generated run evidence stays read-only."
              : "Define one manual replay. The expected staff reply stays hidden from the synthetic agent."}
          </Dialog.Description>
          {!editing ? (
            <div className="eval-dialog__flow">
              Conversation input -&gt; synthetic reply -&gt; expected staff reply + scoring rules
            </div>
          ) : null}
          <div className="eval-dialog__form">
            <label>
              Test name
              <input aria-label="Test name" onChange={(event) => setTitle(event.target.value)} value={title} />
            </label>
            <div className="eval-dialog__form-row">
              <label>
                Evaluation use
                <select
                  aria-label="Evaluation use"
                  onChange={(event) => setSplit(event.target.value as EvalSplit)}
                  value={split}
                >
                  <option value="train">Improve with</option>
                  <option value="holdout">Verify only</option>
                </select>
              </label>
              <label>
                Type
                <select aria-label="Case type" onChange={(event) => setType(event.target.value as EvalCaseType)} value={type}>
                  {CASE_TYPES.map((caseType) => (
                    <option key={caseType} value={caseType}>{formatCaseType(caseType)}</option>
                  ))}
                </select>
              </label>
              <label>
                Language
                <input aria-label="Case language" onChange={(event) => setLanguage(event.target.value)} value={language} />
              </label>
            </div>
            <label>
              Conversation input
              <textarea aria-label="Conversation input" disabled={Boolean(editing)} onChange={(event) => setInput(event.target.value)} value={input} />
            </label>
            {!editing ? (
              <p className="eval-dialog__field-note">
                Single-message manual test. Import a resolved conversation to preserve its earlier
                message sequence.
              </p>
            ) : null}
            <label>
              Expected staff reply
              <textarea aria-label="Expected staff reply" onChange={(event) => setExpected(event.target.value)} value={expected} />
            </label>
            {editing ? (
              <p className="eval-dialog__evidence-note">
                Generated output is run evidence and cannot be edited here.
              </p>
            ) : null}
            <fieldset>
              <legend>Scoring rules</legend>
              {dataset.criteria.length === 0 ? <span>No scoring rules in this dataset.</span> : dataset.criteria.map((criterion) => (
                <label key={criterion.id}>
                  <input
                    checked={criterionIds.includes(criterion.id)}
                    onChange={(event) =>
                      setCriterionIds((current) =>
                        event.target.checked
                          ? [...current, criterion.id]
                          : current.filter((id) => id !== criterion.id),
                      )
                    }
                    type="checkbox"
                  />
                  {criterion.label}
                </label>
              ))}
            </fieldset>
            {error ? <p className="eval-inline-error" role="alert">{error}</p> : null}
          </div>
          <div className="eval-dialog__actions">
            <Dialog.Close asChild><button className="eval-button" type="button">Cancel</button></Dialog.Close>
            <button className="eval-button eval-button--primary" onClick={submit} type="button">
              {editing ? "Save case" : "Add test"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
