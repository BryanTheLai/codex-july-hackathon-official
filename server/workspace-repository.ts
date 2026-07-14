import { z } from "zod";

import {
  revisionSchema,
  serverDomainStateSchema,
  type ServerDomainStatePayload,
} from "../src/contracts/app-state";
import {
  saveWorkspaceResultSchema,
  workspaceEnvelopeSchema,
  workspaceIdSchema,
  type SaveWorkspaceResult,
  type WorkspaceEnvelope,
} from "../src/contracts/api";
import { SCHEMA_VERSION } from "../src/contracts/constants";

const workspaceRecordSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: revisionSchema,
    state: serverDomainStateSchema,
  })
  .strict();

export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;

export interface WorkspaceDataSource {
  read(workspaceId: string): Promise<WorkspaceRecord | null>;
  insertIfAbsent(record: WorkspaceRecord): Promise<WorkspaceRecord | null>;
  updateIfRevision(
    record: WorkspaceRecord,
    expectedRevision: number,
  ): Promise<WorkspaceRecord | null>;
}

export type WorkspaceRepositoryErrorCode =
  | "invalid_input"
  | "invalid_record"
  | "not_found"
  | "storage_failed";

export class WorkspaceRepositoryError extends Error {
  readonly code: WorkspaceRepositoryErrorCode;

  constructor(code: WorkspaceRepositoryErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceRepositoryError";
    this.code = code;
  }
}

export interface WorkspaceRepository {
  load(workspaceId: string): Promise<WorkspaceEnvelope | null>;
  bootstrap(
    workspaceId: string,
    state: ServerDomainStatePayload,
  ): Promise<WorkspaceEnvelope>;
  save(
    workspaceId: string,
    expectedRevision: number,
    state: ServerDomainStatePayload,
  ): Promise<SaveWorkspaceResult>;
}

function parseWorkspaceId(workspaceId: string): string {
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  if (!parsed.success) {
    throw new WorkspaceRepositoryError("invalid_input", "Invalid workspace ID");
  }
  return parsed.data;
}

function parseState(
  state: ServerDomainStatePayload,
): ServerDomainStatePayload {
  const parsed = serverDomainStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new WorkspaceRepositoryError("invalid_input", "Invalid workspace state");
  }
  return parsed.data;
}

function parseRecord(record: WorkspaceRecord): WorkspaceRecord {
  const parsed = workspaceRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new WorkspaceRepositoryError(
      "invalid_record",
      "Stored workspace failed validation",
    );
  }
  return parsed.data;
}

function toEnvelope(record: WorkspaceRecord): WorkspaceEnvelope {
  const parsedRecord = parseRecord(record);
  return workspaceEnvelopeSchema.parse({
    workspaceId: parsedRecord.workspaceId,
    revision: parsedRecord.revision,
    state: parsedRecord.state,
  });
}

export function createWorkspaceRepository(
  dataSource: WorkspaceDataSource,
): WorkspaceRepository {
  return {
    async load(workspaceId) {
      const id = parseWorkspaceId(workspaceId);
      const record = await dataSource.read(id);
      return record ? toEnvelope(record) : null;
    },

    async bootstrap(workspaceId, state) {
      const id = parseWorkspaceId(workspaceId);
      const validState = parseState(state);
      const seedRecord = workspaceRecordSchema.parse({
        workspaceId: id,
        schemaVersion: SCHEMA_VERSION,
        revision: 1,
        state: validState,
      });
      const inserted = await dataSource.insertIfAbsent(seedRecord);
      if (inserted) {
        return toEnvelope(inserted);
      }
      const existing = await dataSource.read(id);
      if (!existing) {
        throw new WorkspaceRepositoryError(
          "storage_failed",
          "Workspace bootstrap did not persist",
        );
      }
      return toEnvelope(existing);
    },

    async save(workspaceId, expectedRevision, state) {
      const id = parseWorkspaceId(workspaceId);
      const revision = revisionSchema.safeParse(expectedRevision);
      if (!revision.success) {
        throw new WorkspaceRepositoryError(
          "invalid_input",
          "Invalid expected revision",
        );
      }
      const nextRecord = workspaceRecordSchema.parse({
        workspaceId: id,
        schemaVersion: SCHEMA_VERSION,
        revision: revision.data + 1,
        state: parseState(state),
      });
      const updated = await dataSource.updateIfRevision(
        nextRecord,
        revision.data,
      );
      if (updated) {
        return saveWorkspaceResultSchema.parse({
          ok: true,
          workspace: toEnvelope(updated),
        });
      }
      const current = await dataSource.read(id);
      if (!current) {
        throw new WorkspaceRepositoryError(
          "not_found",
          "Workspace not found",
        );
      }
      return saveWorkspaceResultSchema.parse({
        ok: false,
        code: "revision_conflict",
        workspace: toEnvelope(current),
      });
    },
  };
}
