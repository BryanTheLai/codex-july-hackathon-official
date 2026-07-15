import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Rows3,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { GlossaryTerm } from "../../components/glossary-term";
import type { Correction, PlaybookFile, PlaybookFileId } from "../../domain";
import { pendingCount } from "./dream-model";

const FILE_DEFINITIONS: Record<string, string> = {
  "Malay booking": "Malay booking handles appointment requests in Malay.",
  "Mandarin prescription": "Mandarin prescription verifies renewal requests in Mandarin.",
  Triage: "Triage prioritizes urgent symptoms before routine requests.",
};

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function folderAncestors(path: string): string[] {
  const segments = path.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function FileListPane({
  corrections,
  files,
  folders,
  onCreateFile,
  onCreateFolder,
  onSelect,
  onSelectFolder,
  revealPath,
  selectedFolderPath,
  selectedId,
}: {
  corrections: Correction[];
  files: PlaybookFile[];
  folders: string[];
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onSelect: (fileId: PlaybookFileId) => void;
  onSelectFolder: (path: string) => void;
  revealPath: string | null;
  selectedFolderPath: string;
  selectedId: PlaybookFileId | null;
}) {
  const [expanded, setExpanded] = useState(
    () => new Set(folderAncestors(selectedFolderPath)),
  );
  const [selectedNodePath, setSelectedNodePath] = useState(
    () => files.find((file) => file.id === selectedId)?.path ?? selectedFolderPath,
  );
  const sortedFolders = useMemo(() => [...folders].sort(), [folders]);
  const sortedFiles = useMemo(
    () => [...files].sort((left, right) => left.path.localeCompare(right.path)),
    [files],
  );

  useEffect(() => {
    const selectedFile = files.find((file) => file.id === selectedId);
    if (!selectedFile) {
      return;
    }
    const ancestors = folderAncestors(parentPath(selectedFile.path));
    setSelectedNodePath(selectedFile.path);
    setExpanded((current) => new Set([...current, ...ancestors]));
  }, [files, selectedId]);

  useEffect(() => {
    if (!revealPath) {
      return;
    }
    const folderPath = revealPath.endsWith(".md") ? parentPath(revealPath) : revealPath;
    setSelectedNodePath(revealPath);
    setExpanded((current) => new Set([...current, ...folderAncestors(folderPath)]));
  }, [revealPath]);

  const toggleFolder = (path: string) => {
    onSelectFolder(path);
    setSelectedNodePath(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderFolder = (path: string, level: number) => {
    const childFolders = sortedFolders.filter(
      (candidate) => candidate !== path && parentPath(candidate) === path,
    );
    const childFiles = sortedFiles.filter((file) => parentPath(file.path) === path);
    const open = expanded.has(path);

    return (
      <div className="dream-tree__branch" key={path} role="none">
        <button
          aria-expanded={open}
          aria-level={level}
          aria-selected={selectedNodePath === path}
          className="dream-tree__row dream-tree__row--folder"
          onClick={() => toggleFolder(path)}
          role="treeitem"
          style={{ paddingInlineStart: `${8 + (level - 1) * 14}px` }}
          type="button"
        >
          {open ? (
            <ChevronDown aria-hidden="true" size={14} />
          ) : (
            <ChevronRight aria-hidden="true" size={14} />
          )}
          {open ? (
            <FolderOpen aria-hidden="true" size={15} />
          ) : (
            <Folder aria-hidden="true" size={15} />
          )}
          <span>{basename(path)}</span>
        </button>
        {open ? (
          <div role="group">
            {childFolders.map((folder) => renderFolder(folder, level + 1))}
            {childFiles.map((file) => {
              const pending = pendingCount(corrections, file.id);
              const definition = FILE_DEFINITIONS[file.title];
              return (
                <button
                  aria-level={level + 1}
                  aria-description={definition}
                  aria-label={`${file.title}, ${basename(file.path)}`}
                  aria-selected={selectedNodePath === file.path}
                  className="dream-tree__row dream-tree__row--file"
                  key={file.id}
                  onClick={() => {
                    onSelectFolder(path);
                    setSelectedNodePath(file.path);
                    onSelect(file.id);
                  }}
                  role="treeitem"
                  style={{ paddingInlineStart: `${22 + (level - 1) * 14}px` }}
                  type="button"
                >
                  <FileText aria-hidden="true" size={15} />
                  <span className="dream-tree__file-copy">
                    {definition ? (
                      <GlossaryTerm definition={definition} focusable={false}>
                        {file.title}
                      </GlossaryTerm>
                    ) : (
                      file.title
                    )}
                    <small>{basename(file.path)}</small>
                  </span>
                  {file.draft !== undefined ? <em>U</em> : null}
                  {pending > 0 ? (
                    <b aria-label={`${pending} pending corrections`}>{pending}</b>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <nav aria-label="Playbook files" className="dream-files">
      <header className="dream-pane-heading">
        <strong>Playbooks</strong>
        <div aria-label="Explorer actions" className="dream-explorer-actions" role="group">
          <button aria-label="New playbook file" onClick={onCreateFile} title="New file" type="button">
            <FilePlus2 aria-hidden="true" size={15} />
          </button>
          <button
            aria-label="New playbook folder"
            onClick={onCreateFolder}
            title="New folder"
            type="button"
          >
            <FolderPlus aria-hidden="true" size={15} />
          </button>
          <button
            aria-label="Collapse playbook folders"
            onClick={() => setExpanded(new Set(["playbooks"]))}
            title="Collapse folders"
            type="button"
          >
            <Rows3 aria-hidden="true" size={15} />
          </button>
        </div>
      </header>
      <div aria-label="Playbook explorer" className="dream-files__tree" role="tree">
        {renderFolder("playbooks", 1)}
      </div>
    </nav>
  );
}
