import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Edit3, MoreHorizontal, Play, Square, X } from "lucide-react";

import { GlossaryTerm } from "../../components/glossary-term";
import type { Correction, EvalCase, EvalCaseId, EvalDataset } from "../../domain";
import { criteriaText, EVAL_GLOSSARY, gradeLabel, inputText } from "./eval-model";

export function CaseEvidence({
  corrections,
  dataset,
  evalCase,
  operationBlocked,
  running,
  onCancel,
  onClose,
  onDelete,
  onDuplicate,
  onEdit,
  onOpenDream,
  onRun,
}: {
  corrections: Correction[];
  dataset: EvalDataset;
  evalCase: EvalCase;
  operationBlocked: boolean;
  running: boolean;
  onCancel: (caseId: EvalCaseId) => void;
  onClose: () => void;
  onDelete: (evalCase: EvalCase) => void;
  onDuplicate: (caseId: EvalCaseId) => void;
  onEdit: (evalCase: EvalCase) => void;
  onOpenDream: (correction: Correction) => void;
  onRun: (caseId: EvalCaseId) => void;
}) {
  const linked = corrections.filter((correction) => correction.sourceCaseId === evalCase.id);
  const history = dataset.runHistory
    .filter((row) => row.caseId === evalCase.id)
    .slice(-5)
    .reverse();
  const criterionById = new Map(dataset.criteria.map((criterion) => [criterion.id, criterion]));
  const needsHumanCorrection = !evalCase.expectedHumanOutput.trim();
  const feedbackReason =
    evalCase.source.kind === "autonomous_feedback" ? evalCase.source.reason : null;

  return (
    <Dialog.Root defaultOpen onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="eval-dialog__overlay" />
        <Dialog.Content aria-label="Case details" className="eval-dialog__content case-evidence">
          <header className="eval-drawer__header">
            <div>
              <Dialog.Title className="visually-hidden">Case details</Dialog.Title>
              <strong>{evalCase.title}</strong>
              <Dialog.Description>
                {evalCase.split === "train" ? "Improve SOP" : "Regression guard"} · {gradeLabel(evalCase.grade)}
              </Dialog.Description>
            </div>
            <button aria-label="Close case details" className="eval-icon-button" onClick={onClose} type="button">
              <X aria-hidden="true" size={17} />
            </button>
          </header>
          <div className="eval-drawer__scroll" tabIndex={0}>
            <section>
              <h2>Patient conversation</h2>
              <pre>{inputText(evalCase)}</pre>
            </section>
            <section className="case-evidence__expected">
              {needsHumanCorrection ? (
                <>
                  <h2>Human correction needed</h2>
                  <p>{feedbackReason ?? "This candidate needs a human reference reply."}</p>
                  <span>Edit this candidate with the response the patient should have received, then run it through Eval.</span>
                </>
              ) : (
                <>
                  <h2><GlossaryTerm definition={EVAL_GLOSSARY.expectedHitl}>Staff-approved reply</GlossaryTerm></h2>
                  <p>{evalCase.expectedHumanOutput}</p>
                  <span>The agent never sees this reply during replay. The judge uses it as one reference for a valid resolution.</span>
                </>
              )}
            </section>
            <section className="case-evidence__actual">
              <h2><GlossaryTerm definition={EVAL_GLOSSARY.actualSynthetic}>Agent reply</GlossaryTerm></h2>
              <p>{evalCase.actualSyntheticOutput ?? "Not run"}</p>
            </section>
            <section>
              <h2>Why it {evalCase.grade?.pass ? "passed" : "did not pass"}</h2>
              <p>{criteriaText(dataset, evalCase)}</p>
              <p>{evalCase.grade?.rationale ?? "Run this case to create result evidence."}</p>
              {evalCase.grade ? (
                <>
                  <ol className="eval-criterion-results">
                    {evalCase.grade.criterionResults.map((result) => (
                      <li key={result.criterionId}>
                        <div>
                          <strong>{criterionById.get(result.criterionId)?.label ?? result.criterionId}</strong>
                          <span className={`eval-status eval-status--${result.verdict.replace("_", "-")}`}>
                            {result.verdict.replace("_", " ")}
                          </span>
                        </div>
                        <p>{result.reason}</p>
                        {result.evidence ? <blockquote>{result.evidence}</blockquote> : null}
                      </li>
                    ))}
                  </ol>
                  <details className="eval-judge-metadata">
                    <summary>Run details</summary>
                    <dl>
                      <div><dt>Mode</dt><dd>{evalCase.grade.metadata.simulated ? "Simulated" : "Live LLM"}</dd></div>
                      <div><dt>Provider</dt><dd>{evalCase.grade.metadata.provider}</dd></div>
                      <div><dt>Model</dt><dd>{evalCase.grade.metadata.model}</dd></div>
                      <div><dt>Prompt</dt><dd>{evalCase.grade.metadata.promptVersion}</dd></div>
                      <div><dt>Run</dt><dd>{evalCase.grade.metadata.runId}</dd></div>
                    </dl>
                  </details>
                </>
              ) : null}
            </section>
            <section>
              <h2>Linked Dream corrections</h2>
              {linked.length === 0 ? <p>No corrections linked to this case.</p> : linked.map((correction) => (
                <button className="eval-linked-correction" disabled={operationBlocked} key={correction.id} onClick={() => onOpenDream(correction)} type="button">
                  <strong>{correction.status}</strong>
                  <span>{correction.evidence}</span>
                </button>
              ))}
              <span>{linked.length > 0 ? "This case produced review evidence, not an active playbook change." : "Case evidence does not approve or change saved playbook text."}</span>
            </section>
            <section>
              <h2>Last 5 runs</h2>
              {history.length === 0 ? <p>No completed runs.</p> : (
                <ol className="eval-run-list">
                  {history.map((row) => (
                    <li key={row.id}>
                      <span>Candidate v{row.candidateVersion}</span>
                      <strong>{row.verdict === "needs_review" ? "Review" : row.verdict === "pass" ? "Pass" : "Fail"}</strong>
                      <span>{row.judgeScore.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <footer className="eval-drawer__footer">
            {running ? (
              <button className="eval-button eval-button--risk" onClick={() => onCancel(evalCase.id)} type="button"><Square aria-hidden="true" size={14} /> Cancel run</button>
            ) : (
              <button className="eval-button eval-button--primary" disabled={operationBlocked || needsHumanCorrection} onClick={() => onRun(evalCase.id)} type="button"><Play aria-hidden="true" size={14} /> Run case</button>
            )}
            <button className="eval-button" disabled={operationBlocked} onClick={() => onEdit(evalCase)} type="button"><Edit3 aria-hidden="true" size={14} /> Edit</button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild><button className="eval-button" disabled={operationBlocked} type="button"><MoreHorizontal aria-hidden="true" size={15} /> More</button></DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" className="eval-menu" sideOffset={4}>
                  <DropdownMenu.Item className="eval-menu__item" onSelect={() => onDuplicate(evalCase.id)}>Duplicate case</DropdownMenu.Item>
                  <DropdownMenu.Item className="eval-menu__item" onSelect={() => onDelete(evalCase)}>Delete case</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
