import type {
  TelegramDeliveryDataSource,
  TelegramDeliveryRecord,
  TelegramDeliveryStatus,
  TelegramEventDataSource,
  TelegramEventRecord,
  TelegramEventStatus,
  TelegramWorkspaceSyncStatus,
} from "../../../server/telegram-repository";

export class InMemoryTelegramEventDataSource
  implements TelegramEventDataSource
{
  readonly records: TelegramEventRecord[] = [];

  async read(updateId: number): Promise<TelegramEventRecord | null> {
    return structuredClone(
      this.records.find((record) => record.updateId === updateId) ?? null,
    );
  }

  async insertIfAbsent(
    record: TelegramEventRecord,
  ): Promise<TelegramEventRecord | null> {
    if (this.records.some((item) => item.updateId === record.updateId)) {
      return null;
    }
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async updateIfStatus(
    record: TelegramEventRecord,
    expectedStatus: TelegramEventStatus,
  ): Promise<TelegramEventRecord | null> {
    const index = this.records.findIndex(
      (item) =>
        item.updateId === record.updateId && item.status === expectedStatus,
    );
    if (index < 0) {
      return null;
    }
    this.records[index] = structuredClone(record);
    return structuredClone(record);
  }
}

export class InMemoryTelegramDeliveryDataSource
  implements TelegramDeliveryDataSource
{
  readonly records: TelegramDeliveryRecord[] = [];

  async read(
    requestId: string,
    part: TelegramDeliveryRecord["part"],
  ): Promise<TelegramDeliveryRecord | null> {
    return structuredClone(
      this.records.find(
        (record) =>
          record.requestId === requestId && record.part === part,
      ) ?? null,
    );
  }

  async insertIfAbsent(
    record: TelegramDeliveryRecord,
  ): Promise<TelegramDeliveryRecord | null> {
    if (
      this.records.some(
        (item) =>
          item.requestId === record.requestId && item.part === record.part,
      )
    ) {
      return null;
    }
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }

  async updateIfStatus(
    record: TelegramDeliveryRecord,
    expectedStatus: TelegramDeliveryStatus,
  ): Promise<TelegramDeliveryRecord | null> {
    const index = this.records.findIndex(
      (item) =>
        item.requestId === record.requestId &&
        item.part === record.part &&
        item.status === expectedStatus,
    );
    if (index < 0) {
      return null;
    }
    this.records[index] = structuredClone(record);
    return structuredClone(record);
  }

  async updateIfSyncStatus(
    record: TelegramDeliveryRecord,
    expectedStatus: TelegramWorkspaceSyncStatus,
  ): Promise<TelegramDeliveryRecord | null> {
    const index = this.records.findIndex(
      (item) =>
        item.requestId === record.requestId &&
        item.part === record.part &&
        item.workspaceSyncStatus === expectedStatus,
    );
    if (index < 0) {
      return null;
    }
    this.records[index] = structuredClone(record);
    return structuredClone(record);
  }
}
