# KaunterAI public YouTube demo

Target: 2 minutes 40 seconds to 2 minutes 55 seconds.

Format: 16:9, 1080p, public YouTube video with spoken audio.

The video should prove the product works. Do not turn it into a moving pitch
deck.

## Before recording

- Reset the demo to the canonical aircon seed.
- Turn off desktop notifications and hide bookmarks, tokens, environment files,
  and browser extensions.
- Open Chat Control, Eval, and Knowledge in separate tabs.
- Use the seeded booking and package-complaint conversations.
- Keep the mouse still while speaking. Move only when the next action is clear.
- Record short clips and edit them together. Do not force a fragile one-take demo.
- If live Telegram or Google Calendar is unstable, show the deterministic seeded
  workflow and do not claim a live provider result.

## 0:00 to 0:15 — The problem

### Show

Use the first pitch-deck slide or the nighttime customer message. Keep this shot
under five seconds, then cut into Chat Control.

### Say

Hi, I'm Bryan. One night around 2 a.m., my aircon broke. I found service
companies on Facebook and messaged them on WhatsApp, but nobody replied. The
operator was busy doing the work. I still needed an answer.

## 0:15 to 0:30 — What KaunterAI does

### Show

Open the booking conversation in Chat Control.

### Say

So I built KaunterAI, an AI service desk for small Malaysian service businesses.
The working demo uses Telegram. It handles Malay or English, by text or voice,
checks the operator's configured rules, and books the job.

## 0:30 to 0:58 — Voice request to confirmed booking

### Show

1. Play or reveal the Malay voice request.
2. Show the RM99 fixed quote.
3. Show a server-returned available slot.
4. Confirm the booking.
5. Hold briefly on the booking or Calendar result.

Use this customer request:

> Hi boss, saya nak general service untuk satu wall unit 1.5 HP. Boleh datang?

### Say

This customer asks for a general service by voice. KaunterAI uses the fixed RM99
rate card, offers only available times returned by the server, and collects the
service address. When the customer confirms, it creates a real booking record,
not just a chat reply.

## 0:58 to 1:20 — Show the mistake

### Show

1. Open the package-complaint conversation.
2. Show: `My 1.5 HP wall unit is not cooling and smells musty.`
3. Show the wrong RM99 general-service reply.
4. Capture the customer's correction.
5. Hold on `Learning signal captured`.

### Say

Now the important part. The customer says the unit is not cooling and smells
musty. The first version gets this wrong and recommends the RM99 general
service. The customer corrects it, and KaunterAI turns that complaint into
evidence.

## 1:20 to 1:45 — Prove the failure

### Show

1. Click `Open Eval candidate`.
2. Show the expected RM160 chemical-wash answer.
3. Run the train case.
4. Hold on the failed criterion.
5. Click `Analyze failures`.

### Say

The complaint opens an Eval case. A human supplies the expected answer, because
the agent should not grade itself. The current SOP fails against that evidence,
and KaunterAI analyzes the exact reason.

## 1:45 to 2:10 — Human-approved learning

### Show

1. Open the proposed Knowledge correction.
2. Hold on the exact Markdown diff.
3. Accept the proposed line.
4. Run `Validate candidate`.
5. Show the passing train and holdout result.
6. Click `Activate`.

### Say

KaunterAI proposes one exact change to the business SOP. The owner can inspect
the line, accept or reject it, test it against the affected cases and the
holdout set, then activate it. A customer complaint can suggest a rule, but it
cannot silently rewrite the business.

## 2:10 to 2:28 — Show the corrected outcome

### Show

1. Return to Chat Control.
2. Ask the same poor-cooling and musty-smell question.
3. Hold on the corrected RM160 chemical-wash reply.
4. Briefly show that `Roll back` is available.

### Say

Ask the same question again, and the next customer gets the RM160 chemical-wash
recommendation. The previous SOP is still available through rollback if the new
rule causes a regression.

## 2:28 to 2:45 — Show how Codex was used

### Show

Use a quick split-screen or two cuts:

1. A real Markdown implementation plan.
2. The terminal showing the passing test suite.

### Say

I built this with Codex and GPT-5.6. I wrote the goal and constraints in
Markdown, then Codex built, tested, inspected failures, repaired them, and
repeated. Hundreds of automated tests now protect the demo loop.

## 2:45 to 2:55 — Close

### Show

End on the KaunterAI product screen with the repository URL in small text.

### Say

KaunterAI turns missed messages into booked jobs, and customer corrections into
tested improvements, without taking control away from the owner.

## Editing rules

- Keep every shot tied to a visible product action or outcome.
- Cut loading time, typing delays, setup, architecture, and environment screens.
- Use captions, but keep them above the product controls.
- Do not show the market-size slides in this video.
- Do not show reschedule, cancellation, or competitor comparisons.
- Do not claim WhatsApp integration. WhatsApp is the personal story; Telegram is
  the working channel.
- Do not claim automatic SOP changes. Human review, validation, and activation
  are the point.
- Keep the final exported duration below three minutes.

## Upload checklist

- [ ] Export at 1920 by 1080.
- [ ] Confirm the video is shorter than three minutes.
- [ ] Confirm narration names Codex and GPT-5.6.
- [ ] Confirm no tokens, API keys, private chats, or personal notifications appear.
- [ ] Upload to YouTube as Public.
- [ ] Open the YouTube URL in a signed-out browser.
- [ ] Add the final URL to `docs/submission.md`.
