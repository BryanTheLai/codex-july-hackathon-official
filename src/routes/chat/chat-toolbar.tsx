import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CalendarDays,
  ChevronDown,
  Inbox,
  MoreHorizontal,
  RefreshCw,
  Search,
  UserRoundPlus,
} from "lucide-react";

import type { ChatFilter, ChatView } from "./chat-model";

const FILTER_OPTIONS: Array<{ value: ChatFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "ai_handling", label: "Autonomous agent" },
  { value: "resolved", label: "Resolved" },
];

export function ChatToolbar({
  count,
  filter,
  query,
  view,
  onFilterChange,
  onQueryChange,
  onRefresh,
  onSimulate,
  onViewChange,
  refreshing,
  syncPending,
}: {
  count: number;
  filter: ChatFilter;
  query: string;
  view: ChatView;
  onFilterChange: (filter: ChatFilter) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onSimulate: () => void;
  onViewChange: (view: ChatView) => void;
  refreshing: boolean;
  syncPending: boolean;
}) {
  return (
    <header className="chat-toolbar">
      <div className="chat-toolbar__title">
        <h1 aria-label="Chat Control" id="chat-route-title">
          <span className="chat-toolbar__title-desktop">Chat Control</span>
          <span aria-hidden="true" className="chat-toolbar__title-mobile">Inbox</span>
        </h1>
        <span aria-label={`${count} visible conversations`} className="chat-toolbar__count">
          {count}
        </span>
        <button
          aria-label={
            syncPending
              ? "Sync accepted Telegram message"
              : "Refresh Telegram inbox"
          }
          className="chat-toolbar__refresh"
          disabled={refreshing}
          onClick={onRefresh}
          title={
            syncPending
              ? "Sync accepted Telegram message"
              : "Refresh Telegram inbox"
          }
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
      </div>

      <div aria-label="Chat views" className="chat-toolbar__views" role="tablist">
        <button
          aria-selected={view === "inbox"}
          className="chat-toolbar__view"
          onClick={() => onViewChange("inbox")}
          role="tab"
          type="button"
        >
          <Inbox aria-hidden="true" size={16} />
          Inbox
        </button>
        <button
          aria-selected={view === "schedule"}
          className="chat-toolbar__view"
          onClick={() => onViewChange("schedule")}
          role="tab"
          type="button"
        >
          <CalendarDays aria-hidden="true" size={16} />
          Schedule
        </button>
      </div>

      <label className="chat-toolbar__search">
        <Search aria-hidden="true" size={16} />
        <span className="visually-hidden">Search conversations</span>
        <input
          aria-label="Search conversations"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          type="search"
          value={query}
        />
      </label>

      <label className="chat-toolbar__filter">
        <span className="visually-hidden">Filter conversations</span>
        <select
          aria-label="Filter conversations"
          onChange={(event) => onFilterChange(event.target.value as ChatFilter)}
          value={filter}
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={14} />
      </label>

      <button className="chat-toolbar__simulate" onClick={onSimulate} type="button">
        <UserRoundPlus aria-hidden="true" size={16} />
        Simulate Customer
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button aria-label="More chat actions" className="chat-toolbar__more" type="button">
            <MoreHorizontal aria-hidden="true" size={18} />
            More
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" className="chat-menu" sideOffset={4}>
            <label className="chat-menu__search">
              <Search aria-hidden="true" size={15} />
              <span className="visually-hidden">Search conversations</span>
              <input
                aria-label="Search conversations"
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search conversations"
                type="search"
                value={query}
              />
            </label>
            <DropdownMenu.Separator className="chat-menu__separator" />
            <DropdownMenu.Label className="chat-menu__label">View</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              onValueChange={(value) => onViewChange(value as ChatView)}
              value={view}
            >
              <DropdownMenu.RadioItem className="chat-menu__item" value="inbox">
                <DropdownMenu.ItemIndicator className="chat-menu__indicator">
                  *
                </DropdownMenu.ItemIndicator>
                Inbox
              </DropdownMenu.RadioItem>
              <DropdownMenu.RadioItem className="chat-menu__item" value="schedule">
                <DropdownMenu.ItemIndicator className="chat-menu__indicator">
                  *
                </DropdownMenu.ItemIndicator>
                Schedule
              </DropdownMenu.RadioItem>
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="chat-menu__separator" />
            <DropdownMenu.Label className="chat-menu__label">Filter</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              onValueChange={(value) => onFilterChange(value as ChatFilter)}
              value={filter}
            >
              {FILTER_OPTIONS.map((option) => (
                <DropdownMenu.RadioItem
                  className="chat-menu__item"
                  key={option.value}
                  value={option.value}
                >
                  <DropdownMenu.ItemIndicator className="chat-menu__indicator">
                    *
                  </DropdownMenu.ItemIndicator>
                  {option.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="chat-menu__separator" />
            <DropdownMenu.Item
              className="chat-menu__item"
              onSelect={() => {
                onSimulate();
              }}
            >
              Simulate Customer
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
