import type { AgentRunResult } from "../contracts/agent";
import type { AppState, ConversationId } from "../domain";
import {
  ApiClientError,
  type AgentClient,
  type WorkspaceClient,
} from "../services/api-client";
import { isAbortError } from "../shared/errors";

export type GenerateAgentDraftResult =
  | {
      ok: true;
      result: AgentRunResult;
    }
  | {
      ok: false;
      error: string;
    };

type AgentSliceDeps = {
  agentClient: AgentClient;
  getState: () => AppState;
  set: (partial: { lastFeedback?: string }) => void;
  workspaceClient: WorkspaceClient;
};

export function createAgentActions({
  agentClient,
  getState,
  set,
  workspaceClient,
}: AgentSliceDeps) {
  let latestGeneration = 0;

  return {
    async generateAgentDraft(
      conversationId: ConversationId,
      signal?: AbortSignal,
    ): Promise<GenerateAgentDraftResult> {
      const generation = ++latestGeneration;
      const report = (lastFeedback: string) => {
        if (
          latestGeneration === generation &&
          getState().selections.conversationId === conversationId
        ) {
          set({ lastFeedback });
        }
      };
      const failed = (error: string): GenerateAgentDraftResult => {
        report(error);
        return { ok: false, error };
      };
      const localConversation = getState().conversations.find(
        (conversation) => conversation.id === conversationId,
      );
      if (!localConversation) {
        return failed("Conversation not found");
      }
      if (localConversation.workflowStatus === "resolved") {
        return failed(
          "Conversation resolved. Reopen it before generating a draft.",
        );
      }
      if (localConversation.agentMode === "staff_only") {
        return failed(
          "Agent mode is Staff only. Turn on agent handling before generating a draft.",
        );
      }

      try {
        const workspace = await workspaceClient.load(signal);
        const serverConversation = workspace.state.conversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (!serverConversation) {
          return failed(
            "Conversation is unavailable in server workspace state.",
          );
        }
        const result = await agentClient.run(
          {
            kind: "manual",
            conversationId,
            expectedConversationRevision:
              serverConversation.revision,
          },
          signal,
        );
        report("Agent draft ready for review.");
        return { ok: true, result };
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (
          error instanceof ApiClientError &&
          error.code === "revision_conflict"
        ) {
          return failed(
            "Conversation changed before generation. Refresh the inbox and retry.",
          );
        }
        return failed(
          error instanceof ApiClientError
            ? error.message
            : "The agent draft could not be generated.",
        );
      }
    },
  };
}
