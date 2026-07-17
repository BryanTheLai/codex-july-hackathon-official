const activeWorkspaceResets = new Set<string>();

export function beginWorkspaceReset(workspaceId: string): void {
  activeWorkspaceResets.add(workspaceId);
}

export function endWorkspaceReset(workspaceId: string): void {
  activeWorkspaceResets.delete(workspaceId);
}

export function isWorkspaceResetInProgress(workspaceId: string): boolean {
  return activeWorkspaceResets.has(workspaceId);
}
