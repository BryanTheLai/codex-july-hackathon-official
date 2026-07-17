import type { Correction, PlaybookFile, SavedTextCheckResult } from "../../domain";

export type KnowledgePane = "files" | "editor" | "changes";

export type TestDockState =
  | { status: "closed" }
  | { status: "preparing"; completed: number; total: number }
  | { status: "running"; completed: number; total: number }
  | { status: "complete"; result: SavedTextCheckResult; stale: boolean }
  | { status: "error"; message: string };

export function fileContent(file: PlaybookFile): string {
  return file.draft ?? file.savedContent;
}

export function fileCorrections(corrections: Correction[], fileId: string): Correction[] {
  return corrections.filter((correction) => correction.fileId === fileId);
}

export function pendingCount(corrections: Correction[], fileId?: string): number {
  return corrections.filter(
    (correction) =>
      correction.status === "pending" && (fileId === undefined || correction.fileId === fileId),
  ).length;
}

export function textMetrics(content: string): { lines: number; words: number } {
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  return { lines: content.split("\n").length, words };
}

export function correctionLine(content: string, correction: Correction): number | null {
  const targetText =
    correction.status === "approved" ? correction.newText : correction.oldText;
  const offset = content.indexOf(targetText);
  if (offset < 0) {
    return null;
  }
  return content.slice(0, offset).split("\n").length;
}
