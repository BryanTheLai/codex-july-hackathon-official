import CodeMirror, {
  type ReactCodeMirrorProps,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Correction, PlaybookFile } from "../../domain";
import { fileContent, textMetrics } from "./dream-model";

class CorrectionPreviewWidget extends WidgetType {
  constructor(
    private readonly oldText: string,
    private readonly newText: string,
  ) {
    super();
  }

  override eq(other: CorrectionPreviewWidget) {
    return this.oldText === other.oldText && this.newText === other.newText;
  }

  override toDOM() {
    const node = document.createElement("div");
    node.className = "cm-correction-preview";
    const removed = document.createElement("div");
    removed.className = "cm-correction-preview__remove";
    removed.textContent = `- ${this.oldText}`;
    const added = document.createElement("div");
    added.className = "cm-correction-preview__add";
    added.textContent = `+ ${this.newText}`;
    node.append(removed, added);
    return node;
  }
}

export function EditorPane({
  corrections,
  dock,
  file,
  focusedCorrectionId,
  focusLine,
  focusRequest,
  onChange,
  onSave,
}: {
  corrections: Correction[];
  dock: ReactNode;
  file: PlaybookFile | null;
  focusedCorrectionId: string | null;
  focusLine: number | null;
  focusRequest: number;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const editor = useRef<ReactCodeMirrorRef | null>(null);
  const region = useRef<HTMLElement | null>(null);
  const [extensions, setExtensions] = useState<ReactCodeMirrorProps["extensions"]>([]);
  const content = file ? fileContent(file) : "";
  const metrics = textMetrics(content);
  const correctionDecorations = useMemo(() => {
    const ranges = corrections.flatMap((correction) => {
      const targetText =
        correction.status === "approved" ? correction.newText : correction.oldText;
      const offset = content.indexOf(targetText);
      if (offset < 0 || offset > content.length) {
        return [];
      }
      const lineFrom = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
      const nextBreak = content.indexOf("\n", offset);
      const lineTo = nextBreak < 0 ? content.length : nextBreak;
      const classes = [
        "cm-correction-line",
        `cm-correction-line--${correction.status}`,
        correction.id === focusedCorrectionId ? "cm-correction-line--focused" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const lineRange = Decoration.line({ attributes: { class: classes } }).range(lineFrom);
      if (correction.status !== "pending") {
        return [lineRange];
      }
      const preview = Decoration.widget({
        block: true,
        side: 1,
        widget: new CorrectionPreviewWidget(correction.oldText, correction.newText),
      }).range(lineTo);
      return [lineRange, preview];
    });
    return [EditorView.decorations.of(Decoration.set(ranges, true))];
  }, [content, corrections, focusedCorrectionId]);

  useEffect(() => {
    let active = true;
    void import("@codemirror/lang-markdown").then(({ markdown }) => {
      if (active) {
        setExtensions([markdown(), EditorView.lineWrapping]);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!focusRequest || !file || !focusLine) {
      return;
    }
    const view = editor.current?.view;
    if (view) {
      const line = view.state.doc.line(Math.min(focusLine, view.state.doc.lines));
      view.dispatch({ scrollIntoView: true, selection: { anchor: line.from } });
      view.focus();
      return;
    }
    const fallback = region.current?.querySelector<HTMLElement>('[role="textbox"], textarea');
    fallback?.focus();
  }, [file, focusLine, focusRequest]);

  return (
    <section
      aria-label="Playbook editor"
      className="dream-editor-pane"
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSave();
        }
      }}
      ref={region}
    >
      {file ? (
        <>
          <header className="dream-editor-status">
            <div>
              <strong>{file.path.replace("playbooks/", "")}</strong>
            </div>
            <span>{metrics.lines} lines | {metrics.words} words</span>
          </header>
          <div className="dream-editor">
            <CodeMirror
              aria-label="Playbook Markdown editor"
              basicSetup={{
                bracketMatching: true,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                lineNumbers: true,
              }}
              extensions={[...(extensions ?? []), ...correctionDecorations]}
              height="100%"
              onChange={onChange}
              onCreateEditor={(view) => {
                view.contentDOM.setAttribute("aria-label", "Playbook Markdown editor");
                view.scrollDOM.setAttribute("aria-label", "Playbook editor scrolling content");
                view.scrollDOM.setAttribute("role", "region");
                view.scrollDOM.tabIndex = 0;
              }}
              ref={editor}
              theme="none"
              value={content}
            />
          </div>
          {dock}
        </>
      ) : (
        <div className="dream-empty">Select a playbook file to edit.</div>
      )}
    </section>
  );
}
