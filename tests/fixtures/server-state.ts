import { createCanonicalSeed } from "../../src/domain";

export function createServerStateFixture() {
  const { selections: _selections, ...domainState } = createCanonicalSeed();
  const activeVersionId = "playbook-version-1";
  return {
    ...domainState,
    conversations: domainState.conversations.map((conversation) => ({
      ...conversation,
      revision: 1,
      patient: {
        ...conversation.patient,
        externalContactId: null,
      },
      channel: "demo" as const,
      source: "synthetic" as const,
      externalConversationId: null,
      latestAgentArtifactId: null,
    })),
    speechArtifacts: [],
    evalArtifacts: {
      suites: [],
      runs: [],
      resolutions: [],
    },
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
          kind: "initial" as const,
          files: domainState.playbookFiles.map((file) => ({
            id: file.id,
            path: file.path,
            title: file.title,
            content: file.savedContent,
            contentHash: `hash-${file.id}`,
            protected: file.protected,
          })),
          bundleHash: "bundle-hash-1",
          passingSuiteId: null,
          createdAt: domainState.fixtureTime,
          activatedAt: domainState.fixtureTime,
        },
      ],
    },
  };
}
