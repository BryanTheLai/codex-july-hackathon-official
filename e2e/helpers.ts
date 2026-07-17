import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import type {
  EvalCaseRunRequest,
  EvalRunArtifact,
  EvalSuiteCreateRequest,
} from "../src/contracts/eval";
import type { JudgeRequest, JudgeResponse } from "../src/contracts/judge";
import type { WorkspaceCommandRequest } from "../src/contracts/workflow";
import {
  analyzeFailures,
  createCandidateFromCorrection,
  createCanonicalSeed,
  createCanonicalServerState,
  freezeEvalSuiteSnapshot,
  generateSyntheticOutput,
} from "../src/domain";
import type { AppState } from "../src/domain";

export async function resetE2eWorkspace(page: Page) {
  const response = await page.request.post("/api/e2e/reset");
  expect(response.status()).toBe(204);
}

export async function performFactoryReset(page: Page) {
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/demo/reset") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Factory reset" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Type RESET to confirm").fill("RESET");
  await dialog.getByRole("button", { name: /^factory reset$/i }).click();
  const response = await resetResponse;
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ ok: true });
}

export async function installMockJudge(page: Page) {
  await page.route("**/api/judge", async (route) => {
    const request = route.request().postDataJSON() as JudgeRequest;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const requiredFailure =
      request.candidateVersion === 1 && request.rubrics.some((rubric) => rubric.required);
    const overallVerdict = requiredFailure ? "fail" : "pass";
    const response: JudgeResponse = {
      overallVerdict,
      judgeScore: requiredFailure ? 0.2 : 0.9,
      rationale: `Simulated browser judge verdict: ${overallVerdict}.`,
      criterionResults: request.rubrics.map((rubric) => ({
        criterionId: rubric.id,
        verdict: requiredFailure && rubric.required ? "fail" : "pass",
        reason:
          requiredFailure && rubric.required
            ? "The candidate version does not satisfy this required scoring rule."
            : "The candidate satisfies this scoring rule.",
        evidence: requiredFailure ? null : request.candidateResponse,
      })),
      metadata: {
        provider: "playwright-fixture",
        model: "deterministic-browser-judge",
        promptVersion: "fixture-v1",
        rubricVersions: Object.fromEntries(
          request.rubrics.map((rubric) => [rubric.id, rubric.version]),
        ),
        runId: request.runId,
        latencyMs: 50,
        simulated: true,
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

export async function installMockEval(page: Page) {
  const local = createCanonicalSeed();
  let server = await createCanonicalServerState();
  let revision = 1;
  let suiteSequence = 0;

  await page.route(/\/api\/workspace\/state$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaceId: "demo",
        revision,
        state: server,
      }),
    });
  });
  await page.route(/\/api\/workspace\/commands$/, async (route) => {
    const request = route.request().postDataJSON() as WorkspaceCommandRequest;
    if (
      request.kind !== "sync_eval_dataset" &&
      request.kind !== "propose_correction" &&
      request.kind !== "create_candidate_from_correction"
    ) {
      await route.continue();
      return;
    }
    if (request.expectedWorkspaceRevision !== revision) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "revision_conflict",
          error: "Workspace revision is stale.",
          retryable: true,
        }),
      });
      return;
    }
    if (request.kind === "sync_eval_dataset") {
      server.evalDatasets = server.evalDatasets.map((dataset) =>
        dataset.id === request.dataset.id ? request.dataset : dataset,
      );
    } else if (request.kind === "propose_correction") {
      const proposed = analyzeFailures(
        server as unknown as AppState,
        request.datasetId,
      );
      if (!proposed.ok) {
        throw new Error(proposed.error);
      }
      server.corrections = proposed.state.corrections;
    } else {
      server = await createCandidateFromCorrection({
        state: server,
        candidateVersionId: `candidate-e2e-${revision + 1}`,
        correctionId: request.correctionId,
        createdAt: new Date().toISOString(),
      });
    }
    revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          workspaceId: "demo",
          revision,
          state: server,
        },
        replay: null,
      }),
    });
  });
  await page.route(
    /\/api\/eval\/suites\/[^/]+\/cases\/[^/]+\/run$/,
    async (route) => {
      const request =
        route.request().postDataJSON() as EvalCaseRunRequest;
      const suite = server.evalArtifacts.suites.find(
        (candidate) => candidate.id === request.suiteId,
      );
      const frozenCase = suite?.cases.find(
        (evalCase) => evalCase.id === request.caseId,
      );
      if (
        !suite ||
        !frozenCase ||
        request.expectedWorkspaceRevision !== revision
      ) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "revision_conflict",
            error: "Workspace revision is stale.",
            retryable: true,
          }),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      const generated = generateSyntheticOutput(local, request.caseId);
      const candidateResponse = generated.ok
        ? generated.output
        : "Synthetic demo response for imported human-reviewed evidence.";
      const rubricIds = new Set(
        frozenCase.judgeBundle.rubricRefs.map(
          (rubric) => rubric.id,
        ),
      );
      const rubrics = suite.rubrics.filter((rubric) =>
        rubricIds.has(rubric.id),
      );
      const requiredFailure = rubrics.some(
        (rubric) => rubric.required,
      );
      const artifact: EvalRunArtifact = {
        id: `eval-run-e2e-${suite.id}-${request.caseId}`,
        suiteId: suite.id,
        caseId: request.caseId,
        attempt: 1,
        candidateResponse,
        agentResult: {
          runId: `agent-run-e2e-${suite.id}-${request.caseId}`,
          draft: {
            englishText: candidateResponse,
            patientLanguage: "English",
            patientText: candidateResponse,
          },
          proposedAction: "reply",
          handoffReason: null,
          evidence: [],
          toolCalls: [],
          stopReason: "completed",
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          latencyMs: 50,
        },
        judgeResult: {
          overallVerdict: requiredFailure ? "fail" : "pass",
          judgeScore: requiredFailure ? 0.2 : 0.9,
          rationale: `Simulated browser judge verdict: ${
            requiredFailure ? "fail" : "pass"
          }.`,
          criterionResults: rubrics.map(
            (rubric) => ({
              criterionId: rubric.id,
              verdict:
                requiredFailure && rubric.required ? "fail" : "pass",
              reason:
                requiredFailure && rubric.required
                  ? "The candidate does not satisfy this required scoring rule."
                  : "The candidate satisfies this scoring rule.",
              evidence:
                requiredFailure && rubric.required
                  ? null
                  : candidateResponse,
            }),
          ),
          metadata: {
            provider: "playwright-fixture",
            model: "deterministic-browser-judge",
            promptVersion: "judge-prompt-v1",
            rubricVersions: Object.fromEntries(
              rubrics.map((rubric) => [
                rubric.id,
                rubric.version,
              ]),
            ),
            runId: `eval-run-e2e-${suite.id}-${request.caseId}`,
            latencyMs: 50,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            simulated: true,
          },
        },
        ranAt: new Date().toISOString(),
      };
      server.evalArtifacts.runs.push(artifact);
      server.evalDatasets = server.evalDatasets.map((dataset) =>
        dataset.id !== suite.datasetId
          ? dataset
          : {
              ...dataset,
              cases: dataset.cases.map((evalCase) =>
                evalCase.id !== request.caseId
                  ? evalCase
                  : {
                      ...evalCase,
                      actualSyntheticOutput: candidateResponse,
                      grade: {
                        pass: artifact.judgeResult.overallVerdict === "pass",
                        verdict: artifact.judgeResult.overallVerdict,
                        judgeScore: artifact.judgeResult.judgeScore,
                        rationale: artifact.judgeResult.rationale,
                        criterionResults: artifact.judgeResult.criterionResults,
                        metadata: artifact.judgeResult.metadata,
                      },
                    },
              ),
              runHistory: [
                ...dataset.runHistory,
                {
                  id: artifact.id,
                  caseId: artifact.caseId,
                  datasetId: dataset.id,
                  ranAt: artifact.ranAt,
                  candidateVersion: dataset.candidateVersion,
                  pass: artifact.judgeResult.overallVerdict === "pass",
                  verdict: artifact.judgeResult.overallVerdict,
                  judgeScore: artifact.judgeResult.judgeScore,
                },
              ],
            },
      );
      revision += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suiteId: suite.id,
          caseId: request.caseId,
          attempt: artifact.attempt,
          status: "committed",
          evalRunId: artifact.id,
          workspaceRevision: revision,
        }),
      });
    },
  );
  await page.route(/\/api\/eval\/suites$/, async (route) => {
    const request =
      route.request().postDataJSON() as EvalSuiteCreateRequest;
    if (request.expectedWorkspaceRevision !== revision) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "revision_conflict",
          error: "Workspace revision is stale.",
          retryable: true,
        }),
      });
      return;
    }
    suiteSequence += 1;
    const suite = await freezeEvalSuiteSnapshot({
      state: server,
      suiteId: `suite-e2e-${suiteSequence}`,
      datasetId: request.datasetId,
      caseIds: request.caseIds,
      playbookVersionId: request.playbookVersionId,
      agentConfig: {
        modelId: "deterministic-browser-agent",
        apiMode: "responses",
        agentConfigVersion: "agent-config-v1",
        promptVersion: "agent-prompt-v1",
        toolPolicyVersion: "demo-no-tools-v1",
      },
      judgeConfig: {
        modelId: "deterministic-browser-judge",
        promptVersion: "judge-prompt-v1",
      },
      baselineSuiteId: null,
      createdAt: new Date().toISOString(),
    });
    server.evalArtifacts.suites.push(suite);
    revision += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suiteId: suite.id,
        manifestHash: suite.manifestHash,
        workspaceRevision: revision,
      }),
    });
  });
}

export async function expectNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const hasScrollOwner = (element: HTMLElement) => {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (
          [style.overflowX, style.overflowY].some((value) =>
            ["auto", "scroll", "hidden", "clip"].includes(value),
          )
        ) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.position === "fixed" || style.display === "none" || hasScrollOwner(element)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.right > viewportWidth + 1 || rect.left < -1;
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
      .slice(0, 10);
    return {
      documentWidth: document.documentElement.scrollWidth,
      offenders,
      viewportWidth,
    };
  });

  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.offenders).toEqual([]);
}

export async function expectNoDocumentVerticalScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
}

export async function expectMobileTargets(page: Page) {
  const undersized = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "button, a, input, select, textarea, [role='tab'], [role='menuitem']",
      ),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0;
      })
      .filter((element) => {
        const target =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.closest("label") ?? element
            : element;
        const rect = target.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      })
      .map((element) => {
        const target =
          element instanceof HTMLInputElement &&
          (element.type === "checkbox" || element.type === "radio")
            ? element.closest("label") ?? element
            : element;
        const rect = target.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          tag: element.tagName.toLowerCase(),
        };
      }),
  );

  expect(undersized).toEqual([]);
}

export async function expectNoSeriousAxeViolations(page: Page) {
  const scan = await new AxeBuilder({ page }).analyze();
  const serious = scan.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    }));
  expect(serious).toEqual([]);
}
