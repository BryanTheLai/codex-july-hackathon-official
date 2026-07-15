import type {
  WorkspaceDataSource,
  WorkspaceRecord,
} from "../../../server/workspace-repository";

export class InMemoryWorkspaceDataSource implements WorkspaceDataSource {
  readonly records = new Map<string, WorkspaceRecord>();

  async read(workspaceId: string): Promise<WorkspaceRecord | null> {
    return structuredClone(this.records.get(workspaceId) ?? null);
  }

  async insertIfAbsent(record: WorkspaceRecord): Promise<WorkspaceRecord | null> {
    if (this.records.has(record.workspaceId)) {
      return null;
    }
    this.records.set(record.workspaceId, structuredClone(record));
    return structuredClone(record);
  }

  async updateIfRevision(
    record: WorkspaceRecord,
    expectedRevision: number,
  ): Promise<WorkspaceRecord | null> {
    const current = this.records.get(record.workspaceId);
    if (!current || current.revision !== expectedRevision) {
      return null;
    }
    this.records.set(record.workspaceId, structuredClone(record));
    return structuredClone(record);
  }
}
