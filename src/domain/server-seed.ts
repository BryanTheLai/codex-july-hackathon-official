import {
  serverDomainStateSchema,
  type PlaybookFileSnapshotPayload,
  type ServerDomainStatePayload,
} from "../contracts/app-state";
import { sha256 } from "./hash";
import { createCanonicalSeed } from "./seed";

async function createPlaybookSnapshots(
  files: ReturnType<typeof createCanonicalSeed>["playbookFiles"],
): Promise<PlaybookFileSnapshotPayload[]> {
  return Promise.all(
    files.map(async (file) => ({
      id: file.id,
      path: file.path,
      title: file.title,
      content: file.savedContent,
      contentHash: await sha256(file.savedContent),
      protected: file.protected,
    })),
  );
}

export async function createCanonicalServerState(): Promise<ServerDomainStatePayload> {
  const { selections: _selections, ...domainState } = createCanonicalSeed();
  const files = await createPlaybookSnapshots(domainState.playbookFiles);
  const activeVersionId = "playbook-version-1";
  const bundleHash = await sha256(
    JSON.stringify(
      files.map((file) => ({
        id: file.id,
        contentHash: file.contentHash,
      })),
    ),
  );

  return serverDomainStateSchema.parse({
    ...domainState,
    conversations: domainState.conversations.map((conversation) => ({
      ...conversation,
      revision: 1,
      patient: {
        ...conversation.patient,
        externalContactId: null,
      },
      channel: "demo",
      source: "synthetic",
      externalConversationId: null,
      latestAgentArtifactId: null,
    })),
    speechArtifacts: [],
    playbookHistory: {
      activeVersionId,
      candidateVersionId: null,
      rollbackTargetVersionId: null,
      versions: [
        {
          id: activeVersionId,
          sequence: 1,
          parentVersionId: null,
          restoredFromVersionId: null,
          kind: "initial",
          files,
          bundleHash,
          passingSuiteId: null,
          createdAt: domainState.fixtureTime,
          activatedAt: domainState.fixtureTime,
        },
      ],
    },
  });
}
