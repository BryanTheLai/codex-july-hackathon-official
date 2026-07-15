import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import express from "express";

import { createCanonicalServerState } from "../../src/domain";
import { createJudgeApp } from "../../server/index";
import { createWorkspaceCommandService } from "../../server/workspace-command-service";
import { createWorkspaceRepository } from "../../server/workspace-repository";
import type { EvalService } from "../../server/eval-service";
import { InMemoryWorkspaceDataSource } from "./fixtures/workspace-data-source";

const workspaceId = "e2e";
const dataSource = new InMemoryWorkspaceDataSource();
const repository = createWorkspaceRepository(dataSource);
const unavailableEval: EvalService = {
  async createSuite() {
    throw new Error("Eval is mocked by browser tests.");
  },
  async runCase() {
    throw new Error("Eval is mocked by browser tests.");
  },
};

await repository.bootstrap(workspaceId, await createCanonicalServerState());

const app = createJudgeApp({
  agent: null,
  eval: null,
  judge: async () => {
    throw new Error("Judge is mocked by browser tests.");
  },
  telegram: null,
  workspace: {
    workspaceId,
    repository,
    createCanonicalState: createCanonicalServerState,
  },
  workflow: createWorkspaceCommandService({
    workspaceId,
    repository,
    evalService: unavailableEval,
    createId: randomUUID,
    now: () => new Date().toISOString(),
  }),
});
app.post("/api/e2e/reset", async (_request, response) => {
  dataSource.records.clear();
  await repository.bootstrap(workspaceId, await createCanonicalServerState());
  response.status(204).end();
});
const distPath = resolve(process.cwd(), "dist");
app.use(express.static(distPath));
app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) {
    next();
    return;
  }
  response.sendFile(resolve(distPath, "index.html"));
});

const argument = process.argv.find((value) => value.startsWith("--port="));
const port = Number(argument?.slice("--port=".length) || 4173);
app.listen(port, () => {
  console.log(`KaunterAI E2E server listening on http://localhost:${port}`);
});
