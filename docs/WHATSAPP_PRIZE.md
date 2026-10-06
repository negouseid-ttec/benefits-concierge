# WhatsApp Prize Description — How AWS End User Messaging Social (WhatsApp) Is Used

Benefits Concierge uses AWS End User Messaging Social (WhatsApp) as a **primary two-way conversational channel** in an omnichannel government-benefits renewal workflow. WhatsApp is not an afterthought — it is the channel where the most critical user actions happen: document submission and appointment booking.

## How WhatsApp Is Integrated

- **SDK**: `@aws-sdk/client-socialmessaging` — the `SendWhatsAppMessage` command is called in the Channel Sender Lambda (`lib/lambda/channel-sender/index.ts`) to deliver agent responses back to the recipient via their WhatsApp number.

- **Inbound webhook**: The WhatsApp Inbound Lambda (`lib/lambda/webhooks/whatsapp-inbound/index.ts`) receives incoming WhatsApp messages via the Meta Cloud API webhook format (delivered through EUM Social), normalizes text messages, media attachments (photos of documents), and interactive button replies into our unified `InboundMessage` type, then routes them to the AI agent orchestrator.

## What WhatsApp Enables That Other Channels Cannot

1. **Document upload via media messages**: Recipients photograph their pay stubs, utility bills, and IDs and send them as WhatsApp media messages. The agent's `upload_document` tool records each attachment against the case and tracks which documents are still missing — completing the renewal without a single office visit. SMS cannot carry media; RCS support is device-dependent. WhatsApp media is the reliable universal path.

2. **Rich conversational Q&A**: Unlike SMS (160-char segments) or RCS (limited device support), WhatsApp supports formatting (*bold*, _italic_), longer messages, and interactive button replies. The agent uses this to explain complex eligibility requirements clearly and confirm appointment details with tap-to-confirm buttons.

3. **Cross-channel continuity**: A recipient who received a proactive SMS reminder and viewed an RCS rich card can seamlessly continue on WhatsApp — the conversation state (DynamoDB, keyed by E.164 phone number) is shared across all channels. The agent picks up exactly where the last message left off, regardless of which channel it arrived on. In the demo, documents uploaded via WhatsApp are immediately reflected when the recipient later checks status via SMS.

## The WhatsApp Journey in the Demo

- **Act 3**: Maria switches to WhatsApp after receiving an SMS reminder and viewing RCS details. She sends two document photos (pay stub + utility bill). The agent calls `upload_document` for each, tracks the remaining requirements, and confirms when all documents are received.
- **Act 4**: Still on WhatsApp, Maria books a verification appointment. The agent calls `schedule_appointment` + `send_confirmation` to book the slot and simultaneously fire a detailed confirmation email via SES.

WhatsApp is the action channel — where the recipient completes the tasks that advance their case from "pending documents" to "under review."
