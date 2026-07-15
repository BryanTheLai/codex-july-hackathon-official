import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { Conversation, ConversationId } from "../../domain";
import {
  formatTimestamp,
  groupedConversations,
  initials,
  latestVisibleMessage,
  type QueueGroup,
} from "./chat-model";

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: (conversationId: ConversationId) => void;
}) {
  const latest = latestVisibleMessage(conversation);
  const preview = latest?.gloss ?? latest?.text ?? "No messages";

  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={`Open conversation with ${conversation.patient.name}`}
      className="queue-row"
      onClick={() => onSelect(conversation.id)}
      title={`${conversation.patient.name}: ${preview}`}
      type="button"
    >
      <span aria-hidden="true" className="queue-row__avatar">
        {initials(conversation.patient.name)}
      </span>
      <span className="queue-row__body">
        <span className="queue-row__line">
          <strong className="queue-row__name">{conversation.patient.name}</strong>
          <time className="queue-row__time" dateTime={latest?.sentAt}>
            {latest ? formatTimestamp(latest.sentAt) : "No time"}
          </time>
        </span>
        <span className="queue-row__preview">{preview}</span>
        <span className="queue-row__meta">
          <span>{conversation.patient.preferredLanguage}</span>
          <span>{conversation.workflowStatus === "resolved" ? "Resolved" : "Open"}</span>
          {conversation.booking?.status === "pending" ? <span>Pending slot</span> : null}
        </span>
      </span>
    </button>
  );
}

function groupLabel(group: QueueGroup, count: number): string {
  const noun = count === 1 ? "conversation" : "conversations";
  return `${group}, ${count} ${noun}`;
}

export function QueuePane({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: ConversationId | null;
  onSelect: (conversationId: ConversationId) => void;
}) {
  const grouped = groupedConversations(conversations);
  const [collapsed, setCollapsed] = useState<Partial<Record<QueueGroup, boolean>>>({});

  const toggleGroup = (group: QueueGroup) => {
    setCollapsed((current) => ({
      ...current,
      [group]: !current[group],
    }));
  };

  return (
    <section aria-label="Conversation queue" className="chat-pane queue-pane" role="region">
      <header className="chat-pane__header">
        <div>
          <strong>Inbox queue</strong>
          <span>{conversations.length} visible</span>
        </div>
      </header>
      <div aria-label="Grouped conversations" className="chat-pane__scroll" tabIndex={0}>
        {grouped.length === 0 ? (
          <div className="chat-empty">
            <strong>No conversations match this search or filter.</strong>
            <span>Change the search or filter to restore the queue.</span>
          </div>
        ) : (
          grouped.map((entry) => {
            const expanded = !collapsed[entry.group];
            return (
              <section className="queue-group" key={entry.group}>
                <button
                  aria-expanded={expanded}
                  aria-label={groupLabel(entry.group, entry.conversations.length)}
                  className={[
                    "queue-group__toggle",
                    entry.group === "Emergency" ? "queue-group__toggle--risk" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => toggleGroup(entry.group)}
                  type="button"
                >
                  <span className="queue-group__toggle-label">{entry.group}</span>
                  <span className="queue-group__toggle-count">{entry.conversations.length}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={expanded ? "queue-group__chevron--open" : undefined}
                    size={14}
                  />
                </button>
                {expanded
                  ? entry.conversations.map((conversation) => (
                      <ConversationRow
                        conversation={conversation}
                        key={conversation.id}
                        onSelect={onSelect}
                        selected={selectedId === conversation.id}
                      />
                    ))
                  : null}
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}
