import { describe, expect, it, vi } from "vitest";

import { AGENT_PROMPT_VERSION } from "../../server/agent-prompt";
import { buildLiveAgentRunRequest } from "../../server/agent-workspace";
import { createEvalService } from "../../server/eval-service";
import { JUDGE_PROMPT_VERSION } from "../../server/judge-prompt";
import {
  createWorkspaceCommandService,
  WorkspaceCommandServiceError,
} from "../../server/workspace-command-service";
import type { AgentRunRequest } from "../../src/contracts/agent";
import type { JudgeRequest, JudgeResponse } from "../../src/contracts/judge";
import {
  activatePlaybookCandidate,
  createCanonicalServerState,
} from "../../src/domain";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const agentConfig = {
  modelId: "agent-model",
  apiMode: "responses" as const,
  agentConfigVersion: "agent-config-v1",
  promptVersion: AGENT_PROMPT_VERSION,
  toolPolicyVersion: "demo-no-tools-v1" as const,
};

const judgeConfig = { modelId: "judge-model", promptVersion: JUDGE_PROMPT_VERSION };

function agentResult(request: AgentRunRequest) {
  const playbook = request.playbookBundle.versions[0]!;
  return {
    runId: `agent-${request.conversation.id}`,
    draft: {
      englishText: "Staff review is required.",
      patientLanguage: request.patientContext.preferredLanguage,
      patientText: "Staff review is required.",
    },
    proposedAction: "reply" as const,
    handoffReason: null,
    evidence: [
      {
        fileId: playbook.fileId,
        versionId: playbook.versionId,
        contentHash: playbook.contentHash,
        excerpt: playbook.content.slice(0, 10),
      },
    ],
    toolCalls: [] as [],
    stopReason: "completed" as const,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs: 10,
  };
}

function judgeResult(request: JudgeRequest): JudgeResponse {
  return {
    overallVerdict: "pass" as const,
    judgeScore: 1,
    rationale: "The candidate satisfies the frozen rubrics.",
    criterionResults: request.rubrics.map((rubric) => ({
      criterionId: rubric.id,
      verdict: "pass" as const,
      reason: "The response requests staff review.",
      evidence: "Staff review is required.",
    })),
    metadata: {
      provider: "test",
      model: judgeConfig.modelId,
      promptVersion: judgeConfig.promptVersion,
      rubricVersions: Object.fromEntries(request.rubrics.map((rubric) => [rubric.id, rubric.version])),
      runId: request.runId,
      latencyMs: 10,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      simulated: true,
    },
  };
}

async function setup(options: { proposer?: Parameters<typeof createWorkspaceCommandService>[0]["proposer"] } = {}) {
  const repository = createWorkspaceRepository(new InMemoryWorkspaceDataSource());
  const seed = await createCanonicalServerState();
  seed.corrections.push({
    id: "corr-aircon-selection",
    fileId: "file-aircon-service-selection",
    oldText: "For poor cooling and a musty smell, quote the RM99 general service.",
    newText:
      "If a wall-mounted 1.0-1.5 HP unit has both poor cooling and a musty smell, recommend the RM160 chemical wash. Do not quote the RM99 general service.",
    evidence: "Combined symptoms train case failed package selection criterion.",
    status: "pending",
    sourceCaseId: "case-aircon-selection-train",
    lineHint: 4,
  });
  await repository.bootstrap("demo", seed);
  let suiteSequence = 0;
  let runSequence = 0;
  let commandSequence = 1;
  const agent = vi.fn(async (request: AgentRunRequest) => agentResult(request));
  const judge = vi.fn(async (request: JudgeRequest) => judgeResult(request));
  const evalService = createEvalService({
    workspaceId: "demo",
    repository,
    agent: { config: agentConfig, run: agent },
    judge: { config: judgeConfig, run: judge },
    createSuiteId: () => `suite-${++suiteSequence}`,
    createEvalRunId: () => `run-${++runSequence}`,
    now: () => "2026-07-14T12:00:00.000Z",
  });
  const service = createWorkspaceCommandService({
    workspaceId: "demo",
    repository,
    evalService,
    createId: () => `version-${++commandSequence}`,
    now: () => "2026-07-14T12:00:00.000Z",
    proposer: options.proposer,
  });
  return { agent, evalService, judge, repository, service };
}

describe("workspace command service", () => {
  it("keeps a correction candidate inactive through affected train and all-case replay, then activates and restores it", async () => {
    const { agent, repository, service } = await setup();
    const seed = await repository.load("demo");
    const correction = seed!.state.corrections.find((candidate) => candidate.status === "pending")!;

    const candidate = await service.execute({
      kind: "create_candidate_from_correction",
      correctionId: correction.id,
      expectedWorkspaceRevision: seed!.revision,
    });
    const candidateId = candidate.workspace.state.playbookHistory.candidateVersionId!;
    expect(candidate.workspace.state.playbookHistory.activeVersionId).toBe("playbook-version-1");

    await expect(
      service.execute({
        kind: "replay_candidate",
        candidateVersionId: candidateId,
        datasetId: "dataset-aircon-ops",
        scope: "full",
        expectedWorkspaceRevision: candidate.workspace.revision,
      }),
    ).rejects.toEqual(
      new WorkspaceCommandServiceError(
        "release_blocked",
        "Run and pass affected train cases before the full Eval replay",
        false,
      ),
    );

    const affected = await service.execute({
      kind: "replay_candidate",
      candidateVersionId: candidateId,
      datasetId: "dataset-aircon-ops",
      scope: "affected",
      expectedWorkspaceRevision: candidate.workspace.revision,
    });
    expect(affected.replay).toMatchObject({ scope: "affected", passed: true, ready: false });
    expect(affected.replay?.passedCases).toBe(affected.replay?.totalCases);

    const full = await service.execute({
      kind: "replay_candidate",
      candidateVersionId: candidateId,
      datasetId: "dataset-aircon-ops",
      scope: "full",
      expectedWorkspaceRevision: affected.workspace.revision,
    });
    expect(full.replay).toMatchObject({ scope: "full", passed: true, ready: true });
    expect(
      full.workspace.state.playbookHistory.versions.find((item) => item.id === candidateId)?.passingSuiteId,
    ).toBe(full.replay?.suiteId);

    const activated = await service.execute({
      kind: "activate_candidate",
      candidateVersionId: candidateId,
      expectedWorkspaceRevision: full.workspace.revision,
    });
    const request = buildLiveAgentRunRequest(
      activated.workspace.state,
      { kind: "manual", conversationId: "convo-aircon-complaint", expectedConversationRevision: 1 },
      agentConfig.agentConfigVersion,
    );
    expect(activated.workspace.state.playbookHistory.activeVersionId).toBe(candidateId);
    expect(request.playbookBundle.versions.every((version) => version.versionId === candidateId)).toBe(true);
    expect(
      request.playbookBundle.versions.find(
        (version) => version.fileId === "file-aircon-service-selection",
      )?.content,
    ).toContain("recommend the RM160 chemical wash");

    const restored = await service.execute({
      kind: "rollback_playbook",
      expectedWorkspaceRevision: activated.workspace.revision,
    });
    const active = restored.workspace.state.playbookHistory.versions.find(
      (item) => item.id === restored.workspace.state.playbookHistory.activeVersionId,
    )!;
    expect(active.kind).toBe("restore");
    expect(active.restoredFromVersionId).toBe("playbook-version-1");
    expect(restored.workspace.state.playbookHistory.rollbackTargetVersionId).toBeNull();
    expect(agent).toHaveBeenCalled();
  });

  it("persists a synchronized Eval dataset before it is frozen for server replay", async () => {
    const { repository, service } = await setup();
    const workspace = await repository.load("demo");
    const dataset = structuredClone(workspace!.state.evalDatasets[0]!);
    dataset.name = "Server-backed imported and manual cases";

    const synced = await service.execute({
      kind: "sync_eval_dataset",
      dataset,
      expectedWorkspaceRevision: workspace!.revision,
    });

    expect(synced.workspace.state.evalDatasets[0]?.name).toBe(dataset.name);
    expect((await repository.load("demo"))?.state.evalDatasets[0]?.name).toBe(dataset.name);
  });

  it("stages Knowledge file creation as an inactive whole-playbook candidate", async () => {
    const { repository, service } = await setup();
    const workspace = await repository.load("demo");

    const staged = await service.execute({
      kind: "create_candidate_from_file",
      file: {
        id: "file-follow-up",
        path: "playbooks/follow-up.md",
        title: "Follow-up SOP",
        content: "# Follow-up\nConfirm the next administrative step.\n",
      },
      expectedWorkspaceRevision: workspace!.revision,
    });

    const candidateId = staged.workspace.state.playbookHistory.candidateVersionId!;
    expect(staged.workspace.state.playbookHistory.activeVersionId).toBe("playbook-version-1");
    expect(
      staged.workspace.state.playbookHistory.versions
        .find((version) => version.id === candidateId)
        ?.files.some((file) => file.path === "playbooks/follow-up.md"),
    ).toBe(true);
    const createRequest = {
      kind: "manual" as const,
      conversationId: "convo-aircon-booking",
      expectedConversationRevision: 1,
    };
    expect(
      buildLiveAgentRunRequest(
        staged.workspace.state,
        createRequest,
        agentConfig.agentConfigVersion,
      ).playbookBundle.versions.some((file) => file.fileId === "file-follow-up"),
    ).toBe(false);

    const readyState = structuredClone(staged.workspace.state);
    const candidate = readyState.playbookHistory.versions.find(
      (version) => version.id === candidateId,
    );
    if (!candidate) {
      throw new Error("Staged candidate was not found");
    }
    candidate.passingSuiteId = "suite-ready";
    const activated = activatePlaybookCandidate({
      state: readyState,
      candidateVersionId: candidateId,
      activatedAt: "2026-07-14T12:01:00.000Z",
    });
    expect(
      buildLiveAgentRunRequest(
        activated,
        createRequest,
        agentConfig.agentConfigVersion,
      ).playbookBundle.versions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "file-follow-up",
          content: "# Follow-up\nConfirm the next administrative step.\n",
        }),
      ]),
    );
  });

  it("turns failed train evidence into a server-persisted, exact LLM proposal without exposing expected answers", async () => {
    const proposal = vi.fn(async (input: { files: Array<{ id: string; content: string }> }) => {
      const file = input.files[0]!;
      const oldText = file.content.split("\n").find(Boolean)!;
      return {
        fileId: file.id,
        oldText,
        newText: `${oldText}\nEscalate unresolved urgent symptoms to a clinician.`,
        rationale: "Adds an explicit urgent escalation instruction.",
      };
    });
    const { evalService, judge, repository, service } = await setup({
      proposer: { propose: proposal },
    });
    const initial = await repository.load("demo");
    const suite = await evalService.createSuite({
      datasetId: "dataset-aircon-ops",
      caseIds: ["case-aircon-selection-train"],
      playbookVersionId: "playbook-version-1",
      expectedWorkspaceRevision: initial!.revision,
    });
    judge.mockImplementationOnce(async (request) => ({
      ...judgeResult(request),
      overallVerdict: "fail" as const,
      criterionResults: request.rubrics.map((rubric) => ({
        criterionId: rubric.id,
        verdict: "fail" as const,
        reason: "Package selection was missing.",
        evidence: "Staff review is required.",
      })),
    }));
    const failed = await evalService.runCase({
      suiteId: suite.suiteId,
      caseId: "case-aircon-selection-train",
      expectedWorkspaceRevision: suite.workspaceRevision,
    });

    const proposed = await service.execute({
      kind: "propose_correction",
      datasetId: "dataset-aircon-ops",
      expectedWorkspaceRevision: failed.workspaceRevision,
    });

    expect(proposal).toHaveBeenCalledTimes(1);
    expect(proposal).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: expect.objectContaining({
          candidateResponse: "Staff review is required.",
        }),
      }),
      undefined,
    );
    expect(JSON.stringify(proposal.mock.calls[0]?.[0])).not.toContain("expectedStaffResponse");
    expect(proposed.workspace.state.corrections.at(-1)).toEqual(
      expect.objectContaining({ status: "pending", sourceCaseId: "case-aircon-selection-train" }),
    );
  });
});
