# Benefits Concierge — Demo Video Script (~3 minutes)

> Record the web UI at `http://127.0.0.1:8777/` while reading this voiceover.
> Click **Play the journey** when indicated. Each act auto-animates.

---

## OPENING (0:00 – 0:25)

**[SCREEN: UI initial state — four empty phones, status strip showing "Missing docs: 2"]**

> Forty-two million Americans depend on SNAP, Medicaid, and other public benefits.
> But agencies still communicate through paper mail that arrives late and phone
> systems that put people on hold for 45 minutes.
>
> **Benefits Concierge** is an AI agent that reaches recipients on the channel
> they prefer — SMS, RCS, WhatsApp, or email — and keeps one continuous
> conversation across all of them.
>
> Let me show you a real benefits-renewal journey.
> Our recipient is Maria Garcia. Her SNAP renewal is due October 20th,
> and she's missing two documents.

**[ACTION: Click "Play the journey"]**

---

## ACT 1 — Proactive SMS Reminder (0:25 – 0:50)

**[SCREEN: SMS phone lights up with the proactive reminder]**

> The agency triggers a proactive outreach. Maria gets an **SMS** — sent via
> **AWS End User Messaging** — reminding her that her SNAP renewal is due in
> 14 days.
>
> She replies "RENEW." The agent calls its **check_case_status** tool —
> you can see the tool chip appear — looks up her case in DynamoDB, and
> tells her exactly what's missing: proof of income and a utility bill.
>
> Notice the status bar: missing docs is still 2.

---

## ACT 2 — RCS Rich Card (0:50 – 1:15)

**[SCREEN: RCS phone lights up with the rich card]**

> Maria switches to **RCS** — still AWS End User Messaging, but now with
> **rich cards and tappable action chips**. She asks "what do I still need?"
>
> The agent calls check_case_status again and responds with a rich card:
> a branded header, her deadline, the document list, and three action
> buttons — Upload Documents, Schedule Appointment, Talk to Someone.
>
> This is the same agent, the same conversation thread, just a richer
> channel. No re-authentication, no repeating herself.

---

## ACT 3 — WhatsApp Document Upload (1:15 – 1:50)

**[SCREEN: WhatsApp phone lights up — media uploads appear]**

> Now Maria opens **WhatsApp** — powered by **AWS End User Messaging Social**.
> She sends a photo of her pay stub. The agent calls **upload_document**,
> records it against her case, and tells her one document remains.
>
> She sends the utility bill. Upload_document runs again — and now watch
> the status bar: **missing docs drops to zero**. All documents received.
>
> This is the key moment: she started on SMS, saw details on RCS, and
> submitted documents on WhatsApp — **one continuous conversation across
> three CDS channels**, with real state changes happening at every step.

---

## ACT 4 — Appointment + SES Email (1:50 – 2:20)

**[SCREEN: WhatsApp phone shows the appointment booking; email phone lights up]**

> Maria asks to book an appointment. The agent calls **schedule_appointment**
> AND **send_confirmation** in one turn — two tools composed together.
>
> It books her for October 8th at 10 AM at the county office, and
> simultaneously fires a confirmation email via **Amazon SES** — watch the
> email phone on the right light up.
>
> That's four AWS CDS services working together: EUM for SMS, EUM for RCS,
> EUM Social for WhatsApp, and SES for email. All orchestrated by a single
> Bedrock-powered agent with tool use.

---

## ACT 5 — Cross-Channel Continuity (2:20 – 2:40)

**[SCREEN: SMS phone lights up again with the status check]**

> Days later, Maria texts "what's my status?" back on plain **SMS**.
>
> The agent picks up the exact same thread — it knows her documents are
> all submitted (that happened on WhatsApp) and her appointment is confirmed
> (that was booked on WhatsApp, confirmed via email). She gets a complete
> answer in one short text.
>
> **One conversation. Four channels. Zero handoffs.**

---

## ACT 6 — Inbound Intelligence + Live Proof (2:40 – 3:05)

**[SCREEN: cut from the web UI to a terminal / inbox showing the real system]**

> Everything you just saw isn't a mockup — it's running on AWS right now.
>
> Here's the inbound side. When a recipient *emails in*, the system doesn't
> just forward the text — a Bedrock-powered **Email Categorization** Lambda
> classifies it first.
>
> **[SHOW: the two live classifications]** A frustrated email about benefits
> being cut off is tagged *complaint — critical — route to a caseworker*.
> A calm question in Spanish is tagged *renewal question — low urgency —
> auto-answer — language es-US*. Same inbox, completely different handling.
>
> **[SHOW: the delivered email in the inbox]** And this is a real email the
> **deployed** agent sent through Amazon SES — inbound email, classified by
> AI, reasoned over by the agent, answered on the right channel, all through
> live Lambdas in one unbroken chain.

---

## CLOSING (3:05 – 3:15)

**[SCREEN: architecture diagram or completion banner]**

> Benefits Concierge is built entirely on AWS — four Communication Developer
> Services (SMS, RCS, WhatsApp, email), Amazon Bedrock with Nova 2 Lite for
> the agent brain and inbound classification, Lambda, DynamoDB, and AWS CDK
> for fully reproducible, one-command infrastructure.
>
> It's not a scripted chatbot — it's an agentic AI that classifies intent,
> reasons, calls tools, and acts across every channel a recipient already uses,
> in any language. Thank you.

---

## Alternate: keep it to 3:00

If you need to stay strictly under 3 minutes, trim ACT 5 (the SMS status check)
to a single sentence and merge ACT 6's live-proof into the closing — the
inbound-classification + real-SES-email proof is the highest-value 20 seconds
in the whole video, so keep that over the second continuity demo.

---

## Recording Notes

- **Resolution:** 1400×900 or 1920×1080 (scale the browser)
- **Frame rate:** 30fps is fine; the animations are CSS-timed
- **Audio:** Record voiceover separately and layer it over the screen capture
  for cleaner audio (or record live — the Play timing is forgiving)
- **Autoplay option:** Use `?autoplay=1` if you want the journey to start
  without clicking, but clicking Play on camera looks more intentional
- **Total runtime target:** 2:50 – 3:00 (the contest limit is ~3 minutes)
- **Tool to record:** QuickTime Player → File → New Screen Recording (macOS),
  or OBS Studio for more control
