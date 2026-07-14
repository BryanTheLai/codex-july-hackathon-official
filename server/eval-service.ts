import {
  agentRunRequestSchema,
  agentRunResultSchema,
  type AgentRunRequest,
  type AgentRunResult,
} from "../src/contracts/agent";
import type { ApiErrorCode } from "../src/contracts/api";
import {
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../src/contracts/app-state";
import {
  evalCaseRunRequestSchema,
  evalCaseRunResultSchema,
  evalRunArtifactSchema,
  evalSuiteCreateRequestSchema,
  evalSuiteCreateResultSchema,
  type DemoEvalCase,
  type EvalCaseRunRequest,
  type EvalCaseRunResult,
  type EvalSuiteCreateRequest,
  type EvalSuiteCreateResult,
  type EvalSuiteSnapshot,
} from "../src/contracts/eval";
import {
  judgeRequestSchema,
  judgeResponseSchema,
  type JudgeRequest,
  type JudgeResponse,
} from "../src/contracts/judge";
import {
  EvalSuiteFreezeError,
  freezeEvalSuiteSnapshot,
} from "../src/domain";
import type { WorkspaceRepository } from "./workspace-repository";

type AgentExecutor = {
  config: EvalSuiteSnapshot["agentConfig"];
  run(
    request: AgentRunRequest,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;
};

type JudgeExecutor = {
  config: EvalSuiteSnapshot["judgeConfig"];
  run(
    request: JudgeRequest,
    signal?: AbortSignal,
  ): Promise<JudgeResponse>;
};

type EvalServiceOptions = {
  workspaceId: string;
  repository: WorkspaceRepository;
  agent: AgentExecutor;
  judge: JudgeExecutor;
  createSuiteId: () => string;
  createEvalRunId: () => string;
  now: () => string;
};

export class EvalServiceError extends Error {
  constructor(
    readonly code: Extract<
      ApiErrorCode,
      | "invalid_request"
      | "not_found"
      | "provider_failed"
      | "revision_conflict"
    >,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EvalServiceError";
  }
}

function fail(
  code: EvalServiceError["code"],
  message: string,
  retryable: boolean,
): never {
  throw new EvalServiceError(code, message, retryable);
}

function configsMatch(
  suite: EvalSuiteSnapshot,
  agent: AgentExecutor,
  judge: JudgeExecutor,
): boolean {
  return (
    suite.agentConfig.modelId === agent.config.modelId &&
    suite.agentConfig.apiMode === agent.config.apiMode &&
    suite.agentConfig.agentConfigVersion ===
      agent.config.agentConfigVersion &&
    suite.agentConfig.promptVersion === agent.config.promptVersion &&
    suite.agentConfig.toolPolicyVersion ===
      agent.config.toolPolicyVersion &&
    suite.judgeConfig.modelId === judge.config.modelId &&
    suite.judgeConfig.promptVersion === judge.config.promptVersion
  );
}

function resolvePlaybookVersion(
  state: ServerDomainStatePayload,
  suite: EvalSuiteSnapshot,
) {
  const version = state.playbookHistory.versions.find(
    (candidate) =>
      candidate.id === suite.playbookBundle.versionId,
  );
  if (
    !version ||
    version.bundleHash !== suite.playbookBundle.bundleHash
  ) {
    fail(
      "provider_failed",
      "Frozen Dream bundle is unavailable",
      false,
    );
  }
  return version;
}

function buildSandboxAgentRequest(
  state: ServerDomainStatePayload,
  suite: EvalSuiteSnapshot,
  evalCase: DemoEvalCase,
): AgentRunRequest {
  const playbookVersion = resolvePlaybookVersion(state, suite);
  const versions = evalCase.generationCase.playbookVersions.map(
    (reference) => {
      const file = playbookVersion.files.find(
        (candidate) =>
          candidate.id === reference.fileId &&
          playbookVersion.id === reference.versionId &&
          candidate.contentHash === reference.contentHash,
      );
      if (!file) {
        fail(
          "provider_failed",
          "Frozen Dream content is unavailable",
          false,
        );
      }
      return {
        ...reference,
        content: file.content,
      };
    },
  );

  return agentRunRequestSchema.parse({
    mode: "sandbox",
    conversation: {
      id: evalCase.id,
      revision: 1,
      messages: evalCase.generationCase.messages,
    },
    patientContext: evalCase.generationCase.patientContext,
    bookingContext: evalCase.generationCase.bookingContext,
    playbookBundle: {
      versions,
      bundleHash: suite.playbookBundle.bundleHash,
    },
    agentConfigVersion:
      evalCase.generationCase.agentConfigVersion,
    promptVersion: evalCase.generationCase.promptVersion,
    toolPolicyVersion:
      evalCase.generationCase.toolPolicyVersion,
  });
}

function validateAgentEvidence(
  request: AgentRunRequest,
  result: AgentRunResult,
): void {
  const contentByPin = new Map(
    request.playbookBundle.versions.map((version) => [
      `${version.fileId}\u0000${version.versionId}\u0000${version.contentHash}`,
      version.content,
    ]),
  );
  for (const evidence of result.evidence) {
    const content = contentByPin.get(
      `${evidence.fileId}\u0000${evidence.versionId}\u0000${evidence.contentHash}`,
    );
    if (!content?.includes(evidence.excerpt)) {
      fail(
        "provider_failed",
        "Agent evidence is not present in the frozen Dream bundle",
        true,
      );
    }
  }
}

function buildFrozenJudgeRequest(
  suite: EvalSuiteSnapshot,
  evalCase: DemoEvalCase,
  candidateResponse: string,
  evalRunId: string,
  candidateVersion: number,
): JudgeRequest {
  const rubrics = evalCase.judgeBundle.rubricRefs.map(
    (reference) => {
      const rubric = suite.rubrics.find(
        (candidate) =>
          candidate.id === reference.id &&
          candidate.version === reference.version,
      );
      if (!rubric) {
        fail(
          "provider_failed",
          "Frozen Eval rubric is unavailable",
          false,
        );
      }
      return rubric;
    },
  );

  return judgeRequestSchema.parse({
    runId: evalRunId,
    datasetId: suite.datasetId,
    caseId: evalCase.id,
    caseType: evalCase.type,
    language: evalCase.language,
    candidateVersion,
    conversation: evalCase.generationCase.messages.map(
      ({ role, text, gloss, language }) => ({
        role,
        text,
        ...(gloss === undefined ? {} : { gloss }),
        ...(language === undefined ? {} : { language }),
      }),
    ),
    candidateResponse,
    expectedResponse: evalCase.judgeBundle.expectedStaffResponse,
    rubrics,
  });
}

function validateJudgeEvidence(
  suite: EvalSuiteSnapshot,
  request: JudgeRequest,
  result: JudgeResponse,
): void {
  const expectedRubrics = new Map(
    request.rubrics.map((rubric) => [rubric.id, rubric.version]),
  );
  if (
    result.metadata.model !== suite.judgeConfig.modelId ||
    result.metadata.promptVersion !==
      suite.judgeConfig.promptVersion ||
    result.metadata.runId !== request.runId ||
    result.criterionResults.length !== expectedRubrics.size
  ) {
    fail("provider_failed", "Judge evidence pins are invalid", true);
  }
  for (const criterion of result.criterionResults) {
    if (
      expectedRubrics.get(criterion.criterionId) !==
        result.metadata.rubricVersions[criterion.criterionId] ||
      (criterion.evidence !== null &&
        !request.candidateResponse.includes(criterion.evidence))
    ) {
      fail("provider_failed", "Judge evidence is invalid", true);
    }
    expectedRubrics.delete(criterion.criterionId);
  }
  if (expectedRubrics.size > 0) {
    fail("provider_failed", "Judge rubric coverage is invalid", true);
  }
}

export function createEvalService({
  workspaceId,
  repository,
  agent,
  judge,
  createSuiteId,
  createEvalRunId,
  now,
}: EvalServiceOptions) {
  async function loadAtRevision(expectedRevision: number) {
    const workspace = await repository.load(workspaceId);
    if (!workspace) {
      fail("not_found", "Workspace was not found", false);
    }
    if (workspace.revision !== expectedRevision) {
      fail(
        "revision_conflict",
        "Workspace revision is stale",
        true,
      );
    }
    return workspace;
  }

  return {
    async createSuite(
      input: EvalSuiteCreateRequest,
    ): Promise<EvalSuiteCreateResult> {
      const request = evalSuiteCreateRequestSchema.parse(input);
      const workspace = await loadAtRevision(
        request.expectedWorkspaceRevision,
      );
      let suite: EvalSuiteSnapshot;
      try {
        suite = await freezeEvalSuiteSnapshot({
          state: workspace.state,
          suiteId: createSuiteId(),
          datasetId: request.datasetId,
          caseIds: request.caseIds,
          playbookVersionId: request.playbookVersionId,
          agentConfig: agent.config,
          judgeConfig: judge.config,
          baselineSuiteId: null,
          createdAt: now(),
        });
      } catch (error) {
        if (error instanceof EvalSuiteFreezeError) {
          fail(
            error.code === "not_found"
              ? "not_found"
              : "invalid_request",
            error.message,
            false,
          );
        }
        throw error;
      }
      const nextState = serverDomainStateSchema.parse(
        structuredClone(workspace.state),
      );
      nextState.evalArtifacts.suites.push(suite);
      const saved = await repository.save(
        workspaceId,
        workspace.revision,
        nextState,
      );
      if (!saved.ok) {
        fail(
          "revision_conflict",
          "Workspace changed while the Eval suite was frozen",
          true,
        );
      }
      return evalSuiteCreateResultSchema.parse({
        suiteId: suite.id,
        manifestHash: suite.manifestHash,
        workspaceRevision: saved.workspace.revision,
      });
    },

    async runCase(
      input: EvalCaseRunRequest,
      signal?: AbortSignal,
    ): Promise<EvalCaseRunResult> {
      const request = evalCaseRunRequestSchema.parse(input);
      const workspace = await loadAtRevision(
        request.expectedWorkspaceRevision,
      );
      const suite = workspace.state.evalArtifacts.suites.find(
        (candidate) => candidate.id === request.suiteId,
      );
      if (!suite) {
        fail("not_found", "Eval suite was not found", false);
      }
      const evalCase = suite.cases.find(
        (candidate) => candidate.id === request.caseId,
      );
      if (!evalCase) {
        fail("not_found", "Eval case was not found", false);
      }
      if (!configsMatch(suite, agent, judge)) {
        fail(
          "provider_failed",
          "Frozen Eval provider configuration is unavailable",
          false,
        );
      }
      const playbookVersion = resolvePlaybookVersion(
        workspace.state,
        suite,
      );
      const attempt =
        Math.max(
          0,
          ...workspace.state.evalArtifacts.runs
            .filter(
              (run) =>
                run.suiteId === suite.id &&
                run.caseId === evalCase.id,
            )
            .map((run) => run.attempt),
        ) + 1;
      const evalRunId = createEvalRunId();
      const agentRequest = buildSandboxAgentRequest(
        workspace.state,
        suite,
        evalCase,
      );

      signal?.throwIfAborted();
      const agentResult = agentRunResultSchema.parse(
        await agent.run(agentRequest, signal),
      );
      validateAgentEvidence(agentRequest, agentResult);
      const candidateResponse = agentResult.draft.englishText;
      const judgeRequest = buildFrozenJudgeRequest(
        suite,
        evalCase,
        candidateResponse,
        evalRunId,
        playbookVersion.sequence,
      );
      signal?.throwIfAborted();
      const judgeResult = judgeResponseSchema.parse(
        await judge.run(judgeRequest, signal),
      );
      validateJudgeEvidence(
        suite,
        judgeRequest,
        judgeResult,
      );
      signal?.throwIfAborted();
      const artifact = evalRunArtifactSchema.parse({
        id: evalRunId,
        suiteId: suite.id,
        caseId: evalCase.id,
        attempt,
        candidateResponse,
        agentResult,
        judgeResult,
        ranAt: now(),
      });
      const nextState = serverDomainStateSchema.parse(
        structuredClone(workspace.state),
      );
      nextState.evalArtifacts.runs.push(artifact);
      const saved = await repository.save(
        workspaceId,
        workspace.revision,
        nextState,
      );
      if (!saved.ok) {
        fail(
          "revision_conflict",
          "Workspace changed while the Eval case was running",
          true,
        );
      }
      return evalCaseRunResultSchema.parse({
        suiteId: suite.id,
        caseId: evalCase.id,
        attempt,
        status: "committed",
        evalRunId,
        workspaceRevision: saved.workspace.revision,
      });
    },
  };
}

export type EvalService = ReturnType<typeof createEvalService>;
