import { CalendarPlus, Link2, Pencil } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  googleCalendarConnectResponseSchema,
  googleCalendarStatusSchema,
  type GoogleCalendarStatus,
} from "../../contracts/calendar";
import {
  malaysiaCalendarDate,
  type Conversation,
  type ConversationId,
} from "../../domain";
import { formatBookingSlot, scheduleDays } from "./chat-model";

export function SchedulePane({
  compact,
  conversations,
  fixtureTime,
  onCreateBooking,
  onEditBooking,
  onOpenConversation,
  onSendCalendar,
}: {
  compact: boolean;
  conversations: Conversation[];
  fixtureTime: string;
  onCreateBooking: (conversationId: ConversationId) => void;
  onEditBooking: (conversationId: ConversationId) => void;
  onOpenConversation: (conversationId: ConversationId) => void;
  onSendCalendar: (conversationId: ConversationId) => void;
}) {
  const days = useMemo(() => scheduleDays(fixtureTime), [fixtureTime]);
  const bookings = conversations.filter(
    (conversation) =>
      conversation.booking &&
      conversation.booking.status !== "rejected" &&
      conversation.booking.status !== "cancelled",
  );
  const bookingCandidates = conversations.filter(
    (conversation) =>
      !conversation.booking ||
      conversation.booking.status === "rejected" ||
      conversation.booking.status === "cancelled",
  );
  const firstBookingDate = bookings[0]?.booking
    ? malaysiaCalendarDate(bookings[0].booking.slotIso)
    : undefined;
  const [selectedDate, setSelectedDate] = useState(firstBookingDate ?? days[0]?.isoDate ?? "");
  const [bookingCandidateId, setBookingCandidateId] = useState(
    bookingCandidates[0]?.id ?? "",
  );
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendarConnectOpen, setCalendarConnectOpen] = useState(false);
  const [calendarAdminToken, setCalendarAdminToken] = useState("");
  const [calendarAuthorizationUrl, setCalendarAuthorizationUrl] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState("");
  const [calendarWorking, setCalendarWorking] = useState(false);

  const loadCalendarStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/calendar/google/status", { signal });
      const parsed = googleCalendarStatusSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) {
        throw new Error("Calendar status is unavailable.");
      }
      setCalendarStatus(parsed.data);
      setCalendarError("");
      if (parsed.data.status === "connected") {
        setCalendarConnectOpen(false);
        setCalendarAuthorizationUrl(null);
      }
    } catch (error) {
      if (signal?.aborted) return;
      setCalendarError(
        error instanceof Error ? error.message : "Calendar status is unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCalendarStatus(controller.signal);
    return () => controller.abort();
  }, [loadCalendarStatus]);

  const calendarNeedsConnection =
    calendarStatus?.configured === true &&
    calendarStatus.status !== "connected";
  const calendarLabel =
    calendarStatus?.status === "connected"
      ? "Google Calendar synced"
      : calendarNeedsConnection
        ? "Google Calendar needs connection"
        : "Demo schedule fallback";

  const startCalendarConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = calendarAdminToken.trim();
    if (!token) {
      setCalendarError("Enter the Calendar admin token.");
      return;
    }
    setCalendarWorking(true);
    setCalendarError("");
    try {
      const response = await fetch("/api/admin/calendar/google/connect", {
        method: "POST",
        headers: { "x-kaunter-admin-token": token },
      });
      const parsed = googleCalendarConnectResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) {
        throw new Error("Google Calendar connection could not be started.");
      }
      setCalendarAuthorizationUrl(parsed.data.authorizationUrl);
      setCalendarAdminToken("");
    } catch (error) {
      setCalendarError(
        error instanceof Error
          ? error.message
          : "Google Calendar connection could not be started.",
      );
    } finally {
      setCalendarWorking(false);
    }
  };

  useEffect(() => {
    if (!days.some((day) => day.isoDate === selectedDate)) {
      setSelectedDate(firstBookingDate ?? days[0]?.isoDate ?? "");
    }
  }, [days, firstBookingDate, selectedDate]);

  useEffect(() => {
    if (!bookingCandidates.some((conversation) => conversation.id === bookingCandidateId)) {
      setBookingCandidateId(bookingCandidates[0]?.id ?? "");
    }
  }, [bookingCandidateId, bookingCandidates]);

  const selectedBookings = bookings.filter(
    (conversation) =>
      conversation.booking &&
      malaysiaCalendarDate(conversation.booking.slotIso) === selectedDate,
  );
  const selectedDay = days.find((day) => day.isoDate === selectedDate);
  const calendarStatusControl = (
    <div className="schedule-calendar-status">
      <span className="chat-badge chat-badge--info">
        <Link2 aria-hidden="true" size={13} />
        {calendarLabel}
      </span>
      {calendarNeedsConnection ? (
        <button
          className="chat-button"
          onClick={() => setCalendarConnectOpen((open) => !open)}
          type="button"
        >
          Connect Google Calendar
        </button>
      ) : null}
    </div>
  );
  const calendarConnectPanel =
    calendarConnectOpen && calendarNeedsConnection ? (
      <form
        aria-label="Connect Google Calendar"
        className="schedule-calendar-connect"
        onSubmit={(event) => void startCalendarConnection(event)}
      >
        <label>
          <span>Calendar admin token</span>
          <input
            aria-label="Calendar admin token"
            autoComplete="off"
            onChange={(event) => setCalendarAdminToken(event.target.value)}
            type="password"
            value={calendarAdminToken}
          />
        </label>
        <button className="chat-button" disabled={calendarWorking} type="submit">
          {calendarWorking ? "Starting connection" : "Get authorization link"}
        </button>
        {calendarAuthorizationUrl ? (
          <>
            <a
              className="chat-button chat-button--primary"
              href={calendarAuthorizationUrl}
              rel="noreferrer"
              target="_blank"
            >
              Continue with Google
            </a>
            <button
              className="chat-button"
              onClick={() => void loadCalendarStatus()}
              type="button"
            >
              Check connection
            </button>
          </>
        ) : null}
        {calendarError ? <span role="alert">{calendarError}</span> : null}
      </form>
    ) : null;
  const createBookingControls = bookingCandidates.length > 0 ? (
    <div className="schedule-pane__create-booking">
      <label>
        <span className="schedule-pane__create-booking-label">Book for</span>
        <select
          aria-label="Customer for new booking"
          onChange={(event) => setBookingCandidateId(event.target.value)}
          value={bookingCandidateId}
        >
          {bookingCandidates.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.patient.name} · {conversation.channel}
            </option>
          ))}
        </select>
      </label>
      <button
        className="chat-button chat-button--primary"
        disabled={!bookingCandidateId}
        onClick={() => onCreateBooking(bookingCandidateId)}
        type="button"
      >
        <CalendarPlus aria-hidden="true" size={14} />
        Create booking
      </button>
    </div>
  ) : null;

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
              <span className={`chat-badge chat-badge--${conversation.booking?.status}`}>
                {conversation.booking?.status}
              </span>
            </button>
            {conversation.channel === "Telegram" &&
            conversation.booking?.status === "approved" ? (
              <button
                aria-label={`Send calendar invitation to ${conversation.patient.name}`}
                className="chat-button schedule-row__calendar"
                onClick={() => onSendCalendar(conversation.id)}
                title="Send the service visit .ics file to Telegram"
                type="button"
              >
                <CalendarPlus aria-hidden="true" size={14} />
                Send calendar
              </button>
            ) : null}
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
          {calendarStatusControl}
        </header>
        {calendarConnectPanel}
        {createBookingControls}
        {bookingList}
      </section>
    );
  }

  return (
    <section aria-label="Service visit schedule" className="schedule-pane" role="region">
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
                      conversation.booking &&
                      malaysiaCalendarDate(conversation.booking.slotIso) === day.isoDate,
                  ).length
                }{" "}
                {bookings.filter(
                  (conversation) =>
                    conversation.booking &&
                    malaysiaCalendarDate(conversation.booking.slotIso) === day.isoDate,
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
            <div className="schedule-pane__header-actions">
              {createBookingControls}
              {calendarStatusControl}
            </div>
          </header>
          {calendarConnectPanel}
          {bookingList}
        </section>
      </div>
    </section>
  );
}
