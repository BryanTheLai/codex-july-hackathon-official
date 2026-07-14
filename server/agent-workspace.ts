import {
  agentRunRequestSchema,
  type AgentRunCreateRequest,
  type AgentRunRequest,
} from "../src/contracts/agent";
import type { ApiErrorCode } from "../src/contracts/api";
import type { ServerDomainStatePayload } from "../src/contracts/app-state";
import { AGENT_PROMPT_VERSION } from "./agent-prompt";

export class AgentWorkspaceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "AgentWorkspaceError";
  }
}

export function buildLiveAgentRunRequest(
  state: ServerDomainStatePayload,
  createRequest: AgentRunCreateRequest,
  agentConfigVersion: string,
): AgentRunRequest {
  const conversation = state.conversations.find(
    (candidate) => candidate.id === createRequest.conversationId,
  );
  if (!conversation) {
    throw new AgentWorkspaceError(
      "not_found",
      false,
      "Conversation was not found",
    );
  }
  if (
    conversation.revision !==
    createRequest.expectedConversationRevision
  ) {
    throw new AgentWorkspaceError(
      "revision_conflict",
      true,
      "Conversation revision is stale",
    );
  }
  if (conversation.workflowStatus === "resolved") {
    throw new AgentWorkspaceError(
      "invalid_request",
      false,
      "Resolved conversations cannot generate drafts",
    );
  }

  const activeVersion = state.playbookHistory.versions.find(
    (version) =>
      version.id === state.playbookHistory.activeVersionId,
  );
  if (!activeVersion) {
    throw new AgentWorkspaceError(
      "provider_failed",
      false,
      "Active Dream bundle is unavailable",
    );
  }

  const request = agentRunRequestSchema.safeParse({
    mode: "live",
    conversation: {
      id: conversation.id,
      revision: conversation.revision,
      messages: conversation.messages,
    },
    patientContext: {
      preferredLanguage: conversation.patient.preferredLanguage,
    },
    bookingContext: conversation.booking ?? null,
    playbookBundle: {
      versions: activeVersion.files.map((file) => ({
        fileId: file.id,
        versionId: activeVersion.id,
        contentHash: file.contentHash,
        content: file.content,
      })),
      bundleHash: activeVersion.bundleHash,
    },
    agentConfigVersion,
    promptVersion: AGENT_PROMPT_VERSION,
    toolPolicyVersion: "demo-no-tools-v1",
  });
  if (!request.success) {
    throw new AgentWorkspaceError(
      "provider_failed",
      false,
      "Workspace agent inputs are invalid",
    );
  }
  return request.data;
}
