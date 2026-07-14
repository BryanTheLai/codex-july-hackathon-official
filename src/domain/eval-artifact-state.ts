import {
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import {
  evalAgentConfigSnapshotSchema,
  evalJudgeConfigSnapshotSchema,
  evalSuiteSnapshotSchema,
  type EvalSuiteSnapshot,
} from "../contracts/eval";
import { sha256 } from "./hash";

export type FreezeEvalSuiteSnapshotInput = {
  state: ServerDomainStatePayload;
  suiteId: string;
  datasetId: string;
  caseIds: string[];
  playbookVersionId: string;
  agentConfig: EvalSuiteSnapshot["agentConfig"];
  judgeConfig: EvalSuiteSnapshot["judgeConfig"];
  baselineSuiteId: string | null;
  createdAt: string;
};

export class EvalSuiteFreezeError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "EvalSuiteFreezeError";
  }
}

export async function freezeEvalSuiteSnapshot(
  input: FreezeEvalSuiteSnapshotInput,
): Promise<EvalSuiteSnapshot> {
  const state = serverDomainStateSchema.parse(input.state);
  const dataset = state.evalDatasets.find(
    (candidate) => candidate.id === input.datasetId,
  );
  if (!dataset) {
    throw new EvalSuiteFreezeError(
      "not_found",
      "Eval dataset was not found",
    );
  }
  if (
    input.caseIds.length === 0 ||
    new Set(input.caseIds).size !== input.caseIds.length
  ) {
    throw new EvalSuiteFreezeError(
      "invalid_input",
      "Eval case identifiers must be unique and non-empty",
    );
  }
  const playbookVersion = state.playbookHistory.versions.find(
    (candidate) => candidate.id === input.playbookVersionId,
  );
  if (!playbookVersion) {
    throw new EvalSuiteFreezeError(
      "not_found",
      "Playbook version was not found",
    );
  }

  const selectedCases = [...input.caseIds].sort().map((caseId) => {
    const evalCase = dataset.cases.find(
      (candidate) => candidate.id === caseId,
    );
    if (!evalCase) {
      throw new EvalSuiteFreezeError(
        "not_found",
        "Eval case was not found",
      );
    }
    return evalCase;
  });
  const rubricIds = [
    ...new Set(selectedCases.flatMap((evalCase) => evalCase.criterionIds)),
  ].sort();
  const rubrics = rubricIds.map((rubricId) => {
    const rubric = dataset.criteria.find(
      (candidate) => candidate.id === rubricId,
    );
    if (!rubric) {
      throw new EvalSuiteFreezeError(
        "not_found",
        "Eval rubric was not found",
      );
    }
    return {
      id: rubric.id,
      label: rubric.label,
      instruction: rubric.instruction,
      required: rubric.required,
      examples: rubric.examples,
      version: rubric.version,
    };
  });
  const playbookVersions = [...playbookVersion.files]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((file) => ({
      fileId: file.id,
      versionId: playbookVersion.id,
      contentHash: file.contentHash,
    }));
  const cases = selectedCases.map((evalCase) => ({
    id: evalCase.id,
    title: evalCase.title,
    split: evalCase.split,
    type: evalCase.type,
    language: evalCase.language,
    generationCase: {
      messages: evalCase.inputConversation.messages,
      patientContext: {
        preferredLanguage: evalCase.language,
      },
      bookingContext: null,
      playbookVersions,
      agentConfigVersion: input.agentConfig.agentConfigVersion,
      promptVersion: input.agentConfig.promptVersion,
      toolPolicyVersion: input.agentConfig.toolPolicyVersion,
    },
    judgeBundle: {
      expectedStaffResponse: evalCase.expectedHumanOutput,
      rubricRefs: evalCase.criterionIds.map((rubricId) => {
        const rubric = dataset.criteria.find(
          (candidate) => candidate.id === rubricId,
        );
        if (!rubric) {
          throw new EvalSuiteFreezeError(
            "not_found",
            "Eval rubric was not found",
          );
        }
        return {
          id: rubric.id,
          version: rubric.version,
        };
      }),
    },
    source: evalCase.source,
  }));
  const playbookBundle = {
    versionId: playbookVersion.id,
    bundleHash: playbookVersion.bundleHash,
    versions: playbookVersions,
  };
  const agentConfig = evalAgentConfigSnapshotSchema.parse(
    input.agentConfig,
  );
  const judgeConfig = evalJudgeConfigSnapshotSchema.parse(
    input.judgeConfig,
  );
  const manifest = {
    datasetId: dataset.id,
    cases,
    rubrics,
    playbookBundle,
    agentConfig,
    judgeConfig,
    baselineSuiteId: input.baselineSuiteId,
  };

  return evalSuiteSnapshotSchema.parse({
    id: input.suiteId,
    ...manifest,
    manifestHash: await sha256(JSON.stringify(manifest)),
    createdAt: input.createdAt,
  });
}
