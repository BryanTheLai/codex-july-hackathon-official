Yes — from a product perspective, turning on Agent handling should immediately deal with the unanswered customer message.
But today it does not. The screenshot’s audit text is literal: “New messages may receive autonomous replies.” It only changes the mode; it does not enqueue/replay the message that arrived while Staff only was active.
So right now:
You turn Agent handling on.
Nothing happens for the already-unanswered message.
The next new Telegram message triggers an auto-reply.
Immediate workaround: send one more customer message in Telegram, e.g. “It’s one 1.5 HP unit.” That should trigger the now-enabled agent. This is not good demo behavior; we should fix it by adding a safe “reply to latest unanswered message” action when autopilot is re-enabled.
Yes, it switched to Staff only because of Calendar.

Yes, it switched to Staff only because of Calendar.
The sequence was:
“Can you come tomorrow?”
→ agent tries live availability
→ live mode requires connected Google Calendar
→ Calendar is disconnected
→ tool returns a hard failure
→ agent chooses staff handoff
→ server sends handoff reply
→ server changes thread to Staff only
Your screenshot is direct proof: “Live availability lookup failed because Google Calendar is not connected.”
That behavior is too aggressive. A missing Calendar connection is an operator setup issue, not a reason to abandon the conversation. It should instead say something like: “I can help with that — I can’t confirm a time just yet, but could you confirm the unit’s HP?” and remain active.

Rewrite the customer-facing fallback so it never mentions internal Calendar configuration.
Fix the 0:00 / 0:00 local voice UI discrepancy.
Don’t switch to Staff only on Calendar-disconnected failures.
Add “Reply now” when autopilot is re-enabled.