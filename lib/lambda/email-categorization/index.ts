/**
 * Email Categorization — the inbound-intelligence hero component.
 *
 * When a benefits recipient emails in (via SES receiving → SNS → this Lambda),
 * we DON'T just dump the text at the agent. First we use Amazon Bedrock to
 * CLASSIFY the email: what does the recipient want, how urgent is it, and does
 * it need a human? That classification drives routing — high-urgency complaints
 * escalate immediately, document submissions go straight to case update, simple
 * questions are auto-answered by the agent.
 *
 * This mirrors AWS's own "Email Categorization" reference sample for an Agentic
 * AI Communications Hub, and turns the system from outbound-reminder-only into
 * a two-way agent that reacts intelligently to inbound customer intent.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage, EmailCategorization } from '../../shared/types';

const bedrock = new BedrockRuntimeClient({});
const lambdaClient = new LambdaClient({});

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME ?? 'bc-agent-orchestrator';

type EmailCategory = EmailCategorization['category'];
type Urgency = EmailCategorization['urgency'];
type Categorization = EmailCategorization;

const CLASSIFY_PROMPT = `You classify inbound emails sent to a government benefits agency (SNAP, Medicaid, TANF, childcare, housing).

Return a JSON object (and NOTHING else) with these fields:
- category: one of renewal_question | document_submission | status_inquiry | appointment_request | complaint_escalation | benefit_change | other
- urgency: one of low | medium | high | critical  (critical = benefits about to lapse, loss of coverage, or a vulnerable-person safety issue)
- needsHuman: boolean (true if it needs a caseworker: legal threats, appeals, complex eligibility disputes, distress)
- language: BCP-47 code of the email's language (e.g. en-US, es-US)
- summary: one sentence, plain language, of what the sender wants
- suggestedAction: one short phrase naming the next step (e.g. "auto-answer status", "route to caseworker", "record document")

Classify accurately. A missed critical/complaint is worse than a false positive.`;

export const handler: Handler = async (event) => {
  // Accept either a raw inbound email event (from SES/SNS) or a normalized message
  const emailText: string = event.text ?? event.emailBody ?? extractText(event);
  const from: string = event.from ?? event.source ?? 'unknown@example.com';

  console.log(`[categorize] Inbound email from ${from}: "${emailText.substring(0, 80)}"`);

  const categorization = await classify(emailText);
  console.log('[categorize] Result:', JSON.stringify(categorization));

  // Route based on classification: everything flows to the agent, but we stamp
  // the categorization so the agent (and any downstream routing) can act on it.
  const inbound: InboundMessage & { categorization: Categorization } = {
    messageId: uuid(),
    channel: 'email',
    from,
    to: event.to ?? event.destination ?? '',
    timestamp: new Date().toISOString(),
    text: emailText,
    categorization,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: AGENT_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ message: inbound })),
    }),
  );

  return { statusCode: 200, categorization };
};

async function classify(emailText: string): Promise<Categorization> {
  const messages: Message[] = [
    { role: 'user', content: [{ text: `Classify this email:\n\n${emailText}` }] },
  ];

  const resp = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: CLASSIFY_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 512, temperature: 0 },
    }),
  );

  const output = resp.output;
  if (!output || !('message' in output) || !output.message) {
    return fallback(emailText);
  }

  const content: ContentBlock[] = output.message.content ?? [];
  const textBlock = content.find(
    (block): block is ContentBlock.TextMember => block.text !== undefined,
  );
  if (!textBlock) return fallback(emailText);

  try {
    // Extract the JSON object from the model's response
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return fallback(emailText);
    const parsed = JSON.parse(match[0]) as Partial<Categorization>;
    return {
      category: parsed.category ?? 'other',
      urgency: parsed.urgency ?? 'medium',
      needsHuman: parsed.needsHuman ?? false,
      language: parsed.language ?? 'en-US',
      summary: parsed.summary ?? 'Inbound email',
      suggestedAction: parsed.suggestedAction ?? 'route to agent',
    };
  } catch {
    return fallback(emailText);
  }
}

function fallback(emailText: string): Categorization {
  // Deterministic keyword fallback if Bedrock is unavailable
  const t = emailText.toLowerCase();
  const complaint = /complaint|lawyer|appeal|unfair|discriminat|supervisor|angry/.test(t);
  return {
    category: complaint ? 'complaint_escalation' : /document|attach|upload|pay stub/.test(t) ? 'document_submission' : 'status_inquiry',
    urgency: complaint || /urgent|immediately|lapse|cut off|emergency/.test(t) ? 'high' : 'medium',
    needsHuman: complaint,
    language: 'en-US',
    summary: 'Inbound email (classified by keyword fallback)',
    suggestedAction: complaint ? 'route to caseworker' : 'route to agent',
  };
}

function extractText(event: Record<string, unknown>): string {
  if (typeof event.content === 'string') return event.content;
  if (typeof event.body === 'string') return event.body;
  return JSON.stringify(event);
}
