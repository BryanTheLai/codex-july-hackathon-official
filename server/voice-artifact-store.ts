import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const objectPathSchema = z.string().trim().min(1).max(1024);

export type StoredVoiceArtifact = {
  contentType: "audio/ogg";
  objectPath: string;
  sha256: string;
};

export interface VoiceArtifactStore {
  download(objectPath: string): Promise<Uint8Array>;
  upload(
    objectPath: string,
    bytes: Uint8Array,
  ): Promise<StoredVoiceArtifact>;
  clearWorkspace(workspaceId: string): Promise<void>;
}

export function voiceWorkspaceStoragePrefixes(workspaceId: string): string[] {
  if (workspaceId === "demo") {
    return ["outbound"];
  }
  return [`${workspaceId}/outbound`, `${workspaceId}`];
}

export class VoiceArtifactStoreError extends Error {}

export function voiceArtifactObjectPath(requestId: string): string {
  return `outbound/${encodeURIComponent(requestId)}.ogg`;
}

export function createSupabaseVoiceArtifactStore(
  client: SupabaseClient,
  bucket: string = "voice-artifacts",
): VoiceArtifactStore {
  const bucketName = z.string().trim().min(1).max(128).parse(bucket);

  async function listObjectPaths(prefix: string): Promise<string[]> {
    const paths: string[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await client.storage.from(bucketName).list(prefix, {
        limit: pageSize,
        offset,
      });
      if (error) {
        throw new VoiceArtifactStoreError("Voice artifact listing failed");
      }
      const items = data ?? [];
      for (const item of items) {
        const childPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null || item.id === undefined) {
          paths.push(...(await listObjectPaths(childPrefix)));
          continue;
        }
        paths.push(childPrefix);
      }
      if (items.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
    return paths;
  }

  return {
    async upload(inputPath, bytes) {
      const objectPath = objectPathSchema.parse(inputPath);
      if (bytes.byteLength === 0) {
        throw new VoiceArtifactStoreError("Voice artifact must not be empty");
      }
      const { error } = await client.storage
        .from(bucketName)
        .upload(objectPath, bytes, {
          contentType: "audio/ogg",
          upsert: true,
        });
      if (error) {
        throw new VoiceArtifactStoreError("Voice artifact upload failed");
      }
      return {
        objectPath,
        contentType: "audio/ogg",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },

    async download(inputPath) {
      const objectPath = objectPathSchema.parse(inputPath);
      const { data, error } = await client.storage.from(bucketName).download(objectPath);
      if (error || !data) {
        throw new VoiceArtifactStoreError("Voice artifact download failed");
      }
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new VoiceArtifactStoreError("Voice artifact is empty");
      }
      return bytes;
    },

    async clearWorkspace(workspaceId) {
      const prefixes = voiceWorkspaceStoragePrefixes(workspaceId);
      const objectPaths = (
        await Promise.all(prefixes.map((prefix) => listObjectPaths(prefix)))
      ).flat();
      if (objectPaths.length === 0) {
        return;
      }
      const { error } = await client.storage.from(bucketName).remove(objectPaths);
      if (error) {
        throw new VoiceArtifactStoreError("Voice artifact cleanup failed");
      }
    },
  };
}
