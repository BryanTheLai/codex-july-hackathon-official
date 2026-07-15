import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Conversation, ConversationId } from "../../domain";
import { formatBookingSlot, scheduleDays } from "./chat-model";

export function SchedulePane({
  compact,
  conversations,
  fixtureTime,
  onEditBooking,
  onOpenConversation,
}: {
  compact: boolean;
  conversations: Conversation[];
  fixtureTime: string;
  onEditBooking: (conversationId: ConversationId) => void;
  onOpenConversation: (conversationId: ConversationId) => void;
}) {
  const days = useMemo(() => scheduleDays(fixtureTime), [fixtureTime]);
  const bookings = conversations.filter(
    (conversation) =>
      conversation.booking &&
      conversation.booking.status !== "rejected" &&
      conversation.booking.status !== "cancelled",
  );
  const firstBookingDate = bookings[0]?.booking?.slotIso.slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(firstBookingDate ?? days[0]?.isoDate ?? "");

  useEffect(() => {
    if (!days.some((day) => day.isoDate === selectedDate)) {
      setSelectedDate(firstBookingDate ?? days[0]?.isoDate ?? "");
    }
  }, [days, firstBookingDate, selectedDate]);

  const selectedBookings = bookings.filter(
    (conversation) => conversation.booking?.slotIso.slice(0, 10) === selectedDate,
  );
  const selectedDay = days.find((day) => day.isoDate === selectedDate);

  const bookingList = (
    <div aria-label="Bookings for selected day" className="schedule-list" tabIndex={0}>
      {bookings.length === 0 ? (
        <div className="chat-empty chat-empty--center">
          <strong>No synthetic bookings in this seven-day window.</strong>
          <span>Day selection remains available.</span>
        </div>
      ) : selectedBookings.length === 0 ? (
        <div className="chat-empty chat-empty--center">
          <strong>No synthetic bookings on {selectedDay?.label ?? "this day"}.</strong>
          <span>Select another day in the seven-day window.</span>
        </div>
      ) : (
        selectedBookings.map((conversation) => (
          <div className="schedule-row" key={conversation.id}>
            <button
              aria-label={`Open conversation with ${conversation.patient.name}`}
              className="schedule-row__open"
              onClick={() => onOpenConversation(conversation.id)}
              type="button"
            >
              <time dateTime={conversation.booking?.slotIso}>
                {formatBookingSlot(conversation.booking!.slotIso)}
              </time>
              <strong>{conversation.patient.name}</strong>
              <span>{conversation.booking?.provider}</span>
              <span className={`chat-badge chat-badge--${conversation.booking?.status}`}>
                {conversation.booking?.status}
              </span>
            </button>
            <button
              aria-label={`Edit booking for ${conversation.patient.name}`}
              className="chat-icon-button schedule-row__edit"
              onClick={() => onEditBooking(conversation.id)}
              title="Edit booking"
              type="button"
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  );

  if (compact) {
    return (
      <section
        aria-label="Synthetic schedule"
        className="schedule-pane schedule-pane--compact"
        role="region"
      >
        <header className="schedule-pane__compact-header">
          <label>
            <span className="visually-hidden">Schedule day</span>
            <select
              aria-label="Schedule day"
              onChange={(event) => setSelectedDate(event.target.value)}
              value={selectedDate}
            >
              {days.map((day) => (
                <option key={day.isoDate} value={day.isoDate}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
          <strong>Synthetic schedule</strong>
        </header>
        {bookingList}
      </section>
    );
  }

  return (
    <section aria-label="Synthetic schedule" className="schedule-pane" role="region">
      <div className="schedule-board">
        <nav
          aria-label="Schedule day index"
          className="schedule-day-index"
          role="region"
          tabIndex={0}
        >
          <header>
            <strong>Demo week</strong>
            <span>7 days</span>
          </header>
        {days.map((day) => (
          <button
            aria-pressed={day.isoDate === selectedDate}
            key={day.isoDate}
            onClick={() => setSelectedDate(day.isoDate)}
            type="button"
          >
              <span>{day.label}</span>
              <span>
                {
                  bookings.filter(
                    (conversation) =>
                      conversation.booking?.slotIso.slice(0, 10) === day.isoDate,
                  ).length
                }{" "}
                {bookings.filter(
                  (conversation) =>
                    conversation.booking?.slotIso.slice(0, 10) === day.isoDate,
                ).length === 1
                  ? "booking"
                  : "bookings"}
              </span>
          </button>
        ))}
        </nav>
        <section aria-label={`Bookings for ${selectedDay?.label ?? "selected day"}`} className="schedule-detail">
          <header className="schedule-pane__header">
            <div>
              <h2>{selectedDay?.label ?? "Selected day"}</h2>
              <span>
                {selectedBookings.length} {selectedBookings.length === 1 ? "booking" : "bookings"}{" "}
                scheduled
              </span>
            </div>
            <span className="chat-badge chat-badge--info">Synthetic schedule</span>
          </header>
          {bookingList}
        </section>
      </div>
    </section>
  );
}
