/**
 * Local agent runner.
 *
 * Reuses the REAL system prompt and tool config from the production
 * orchestrator (lib/lambda/agent-orchestrator/prompt.ts). Runs the agent
 * loop against the in-memory tool executor.
 *
 * Two modes:
 *   - LIVE: if AWS credentials + Bedrock access are present, it calls the
 *     real Bedrock Converse API (set DEMO_LIVE_BEDROCK=1).
 *   - SCRIPTED (default): a deterministic agent that calls the real tools
 *     and produces realistic responses — so the demo runs fully offline.
 */

import type { Conversation, ConversationTurn, Channel } from '../../lib/shared/types';
import { SYSTEM_PROMPT, buildToolConfig } from '../../lib/lambda/agent-orchestrator/prompt';
import { executeToolCall } from './tools';

const USE_LIVE = process.env.DEMO_LIVE_BEDROCK === '1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-2-lite-v1:0';

export interface AgentResult {
  responseText: string;
  toolCalls: { tool: string; input: Record<string, unknown>; output: string }[];
}

export async function runAgent(
  conversation: Conversation,
  userText: string,
  channel: Channel,
): Promise<AgentResult> {
  conversation.history.push({
    role: 'user',
    channel,
    content: userText,
    timestamp: new Date().toISOString(),
  });

  const result = USE_LIVE
    ? await runLive(conversation)
    : await runScripted(conversation, userText);

  conversation.history.push({
    role: 'assistant',
    channel,
    content: result.responseText,
    timestamp: new Date().toISOString(),
    toolCalls: result.toolCalls,
  });

  return result;
}

// ─── LIVE: real Bedrock Converse ────────────────────────────────────────────

async function runLive(conversation: Conversation): Promise<AgentResult> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const bedrock = new BedrockRuntimeClient({});
  const toolConfig = buildToolConfig();
  const allToolCalls: AgentResult['toolCalls'] = [];

  const messages: any[] = conversation.history.map((t) => ({
    role: t.role,
    content: [{ text: t.content }],
  }));

  for (let round = 0; round < 5; round++) {
    const resp = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: 1024, temperature: 0.3 },
      }),
    );
    const msg = (resp.output as any).message;
    messages.push(msg);

    const toolUses = (msg.content ?? []).filter((b: any) => 'toolUse' in b);
    if (!toolUses.length) {
      const textBlock = (msg.content ?? []).find((b: any) => 'text' in b);
      return { responseText: textBlock?.text ?? '(no response)', toolCalls: allToolCalls };
    }

    const toolResults: any[] = [];
    for (const b of toolUses) {
      const tu = b.toolUse;
      const out = await executeToolCall(tu.name, tu.input, conversation);
      const outStr = typeof out === 'string' ? out : JSON.stringify(out);
      allToolCalls.push({ tool: tu.name, input: tu.input, output: outStr });
      toolResults.push({ toolResult: { toolUseId: tu.toolUseId, content: [{ text: outStr }] } });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { responseText: 'I had trouble completing that. Let me connect you with a caseworker.', toolCalls: allToolCalls };
}

// ─── SCRIPTED: deterministic offline agent ──────────────────────────────────
// Interprets intent from keywords, calls the REAL tools, formats a response.

async function runScripted(conversation: Conversation, userText: string): Promise<AgentResult> {
  const text = userText.toLowerCase();
  const toolCalls: AgentResult['toolCalls'] = [];
  const rid = conversation.recipientId;

  async function call(tool: string, input: Record<string, unknown>) {
    const out = await executeToolCall(tool, input, conversation);
    toolCalls.push({ tool, input, output: JSON.stringify(out) });
    return out as any;
  }

  // Intent: start renewal / status / what do I need
  if (/renew|status|what do i|what's|whats|due|need/.test(text)) {
    const res = await call('check_case_status', { recipientId: rid });
    const snapCase = (res.cases ?? []).find((c: any) => c.status === 'pending_renewal');
    if (snapCase) {
      const docs = snapCase.missingDocuments ?? [];
      return {
        responseText:
          docs.length > 0
            ? `Hi ${snapCase.recipientName}! Your ${snapCase.programType.toUpperCase()} renewal is due ${snapCase.renewalDeadline}. You still need: ${docs.join(' and ')}. You can send photos right here. Want to upload them now?`
            : `Your ${snapCase.programType.toUpperCase()} renewal is due ${snapCase.renewalDeadline} and all your documents are on file. Would you like to schedule a review appointment?`,
        toolCalls,
      };
    }
    return { responseText: 'I checked your cases — everything looks up to date! Is there anything else I can help with?', toolCalls };
  }

  // Intent: uploading a document (simulated media)
  if (/upload|here is|here's|attach|photo|pay stub|paystub|utility|document|sending/.test(text)) {
    const docType = /utility/.test(text) ? 'utility_bill' : 'proof_of_income';
    const res = await call('upload_document', {
      caseId: 'SNAP-2026-04821',
      documentType: docType,
      mediaUrl: 'local://demo/sample-document.jpg',
    });
    return {
      responseText: res.remainingDocuments?.length
        ? `Got it — I've recorded your ${docType.replace(/_/g, ' ')}. ${res.message} Send the next one whenever you're ready.`
        : `Perfect — ${res.message} I'll send you a confirmation email with everything on file.`,
      toolCalls,
    };
  }

  // Intent: schedule appointment
  if (/appointment|schedule|meet|office|visit|book/.test(text)) {
    const res = await call('schedule_appointment', { caseId: 'SNAP-2026-04821', type: 'in_person' });
    const when = res.appointment?.scheduledAt;
    await call('send_confirmation', {
      recipientId: rid,
      subject: 'Appointment Confirmed — SNAP Renewal',
      body: `Your in-person appointment is confirmed for ${when} at ${res.appointment?.location}.`,
      includeAppointmentDetails: true,
    });
    return {
      responseText: `Done! I booked you an in-person appointment on ${when?.split('T')[0]} at 10:00 AM, ${res.appointment?.location}. I just emailed you the full details. See you there!`,
      toolCalls,
    };
  }

  // Intent: confirm / thanks / done → send confirmation email
  if (/thank|thanks|done|confirm|great|perfect|ok|okay/.test(text)) {
    await call('send_confirmation', {
      recipientId: rid,
      subject: 'Your SNAP Renewal — Status Update',
      body: 'Thanks for working with Benefits Concierge! Here is a summary of your renewal progress and next steps.',
      includeAppointmentDetails: true,
    });
    return {
      responseText: "You're all set! I've emailed you a summary with your next steps. Text me anytime — I'll pick up right where we left off, on whatever channel is easiest for you.",
      toolCalls,
    };
  }

  // Intent: speak to a human
  if (/human|person|agent|caseworker|representative|speak|talk to/.test(text)) {
    const res = await call('escalate_to_agent', { recipientId: rid, reason: 'Recipient requested a human caseworker' });
    return { responseText: `No problem — ${res.message} Your reference number is ${res.referenceNumber}.`, toolCalls };
  }

  // Fallback
  const res = await call('check_case_status', { recipientId: rid });
  return {
    responseText: `I can help with your benefits. You have ${(res.cases ?? []).length} active case(s). I can check your renewal status, help upload documents, or schedule an appointment. What would you like to do?`,
    toolCalls,
  };
}
