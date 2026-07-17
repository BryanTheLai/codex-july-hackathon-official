# KaunterAI 3-minute presentation script

Target: 2 minutes 45 seconds to 3 minutes.

## Slide 1

Hi, I'm Bryan, and I'm building for the MSMEs, Finance and Productivity track.

One night around 2 a.m., my aircon broke, so I found a few service companies on Facebook and messaged them on WhatsApp because I did not want to wait until morning.

Nobody replied.

Even the next morning, some replies came hours late, so I picked whoever answered first. The operator was busy doing the work. I still needed an answer.

## Slide 2

That is why I built KaunterAI.

The working demo uses Telegram, but the workflow starts with the same customer message. It understands Malay or English, by text or voice, checks the operator's configured prices and available times, then books the job.

The operator keeps working. The customer gets an answer.

## Slide 3

But a fast answer can still be wrong.

Here, the customer needed a RM160 chemical wash, but the agent quoted the RM99 general service.

The correction becomes an Eval failure. KaunterAI proposes one exact SOP change, and a human decides whether to accept it.

The AI learns, but it cannot rewrite the business rules by itself.

## Slide 4

I built this with Codex and GPT-5.6.

I write the goal and constraints in Markdown. Codex builds, runs tests, checks failures, fixes them, and repeats.

That loop covered booking conflicts, multilingual voice, Eval corrections, calendar delivery, and safe resets. More than 550 automated tests now pass across 82 files.

## Slide 5

KaunterAI sells software, not aircon servicing.

A public Malaysian directory lists more than 4,254 home-service providers. That is a starting signal, not the whole market or a forecast.

RM88 a month is also a hypothesis. At 50,000 accounts across several industries, the math is RM52.8 million in annual recurring revenue.

## Slide 6

Aircon is the first door.

We solve answer, quote, and book. Then customers tell us what hurts next: inventory, dispatch, payments, invoicing, maintenance, or staffing.

We only build what they keep asking for, then test the same pattern in property, workshops, beauty, clinics, and tuition.

## Slide 7

Next, I will not run ads.

I will call ten operators, shadow three service days, manually onboard three businesses, and measure reply time, bookings, and owner hours saved.

Now let me show the working loop live: a Malay or voice request, a booking, a correction, and a human-approved SOP change.

## Delivery notes

- Do not rush the first story.
- Pause after "Nobody replied."
- Look at the judges for the final sentence of each slide.
- Do not explain the appendix unless a judge asks.
- After Slide 7, leave the deck and start the live demo immediately.

## Source notes

Do not read this section aloud.

- Presentation format and submission rules: `docs/hackathon-annoouncements.txt`
- Current product behavior and boundaries: `README.md` and `PROJECT.md`
- Final deck structure and claim boundaries: `.tmp/kaunterai-deck-v3/design.md`
- Provider-directory figure: https://seekhomefix.my/
- Revenue arithmetic: `50,000 × RM88 × 12 = RM52.8 million`
