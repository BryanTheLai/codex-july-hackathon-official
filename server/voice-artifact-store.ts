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
  };
}
