import {
  domainStateSchema,
  serverDomainStateSchema,
  type DomainStatePayload,
  type PlaybookFileSnapshotPayload,
  type ServerDomainStatePayload,
} from "../src/contracts/app-state";
import { sha256 } from "../src/domain/hash";

export const DOMAIN_SOURCE_STATE_KEYS = [
  "schemaVersion",
  "fixtureTime",
  "conversations",
  "playbookFolders",
  "playbookFiles",
  "corrections",
  "evalDatasets",
] as const;

export function extractDomainSourceKeys(
  sourceState: unknown,
): readonly (typeof DOMAIN_SOURCE_STATE_KEYS)[number][] {
  domainStateSchema.parse(sourceState);
  return DOMAIN_SOURCE_STATE_KEYS;
}

async function createPlaybookSnapshots(
  files: DomainStatePayload["playbookFiles"],
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

function mapPatient(patient: DomainStatePayload["conversations"][number]["patient"]) {
  return {
    ...patient,
    medicalRecordNumber:
      patient.medicalRecordNumber.trim() === "" ? null : patient.medicalRecordNumber,
    externalContactId: null,
  };
}

export async function compileDemoSeedSource(
  sourceState: unknown,
): Promise<ServerDomainStatePayload> {
  const domainState = domainStateSchema.parse(sourceState);
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
      patient: mapPatient(conversation.patient),
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
    evalArtifacts: {
      suites: [],
      runs: [],
      resolutions: [],
    },
  });
}
