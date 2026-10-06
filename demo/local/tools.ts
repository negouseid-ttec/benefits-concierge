/**
 * Local tool executor — mirrors lib/lambda/agent-orchestrator/tools.ts
 * but operates against the in-memory store instead of DynamoDB, and
 * captures outbound messages to a transcript instead of calling EUM/SES.
 */

import { v4 as uuid } from 'uuid';
import type { Conversation, BenefitsCase, Appointment, Channel } from '../../lib/shared/types';
import { cases, appointments, getConversation } from './store';

// ─── Transcript (captures what each channel would send) ─────────────────────

export interface TranscriptEntry {
  direction: 'inbound' | 'outbound';
  channel: Channel;
  text: string;
  meta?: Record<string, unknown>;
}

export const transcript: TranscriptEntry[] = [];

export function record(entry: TranscriptEntry): void {
  transcript.push(entry);
}

// ─── Tool executor ──────────────────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  switch (toolName) {
    case 'check_case_status':
      return checkCaseStatus(input, conversation);
    case 'schedule_appointment':
      return scheduleAppointment(input, conversation);
    case 'upload_document':
      return uploadDocument(input, conversation);
    case 'send_confirmation':
      return sendConfirmation(input, conversation);
    case 'escalate_to_agent':
      return escalateToAgent(input, conversation);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function sanitizeCase(c: BenefitsCase): Record<string, unknown> {
  return {
    caseId: c.caseId,
    programType: c.programType,
    status: c.status,
    recipientName: c.recipientName,
    renewalDeadline: c.renewalDeadline,
    missingDocuments: c.missingDocuments,
    lastActionDate: c.lastActionDate,
    nextActionRequired: c.nextActionRequired,
    caseworkerName: c.caseworkerName,
    countyOffice: c.countyOffice,
  };
}

function checkCaseStatus(input: Record<string, unknown>, conversation: Conversation): unknown {
  const { caseId, recipientId } = input as { caseId?: string; recipientId?: string };

  if (caseId) {
    const c = cases.get(caseId);
    if (!c) return { found: false, message: `No case found with ID ${caseId}.` };
    return { found: true, case: sanitizeCase(c) };
  }

  const lookupId = recipientId ?? conversation.recipientId;
  const matched = [...cases.values()].filter((c) => c.recipientId === lookupId);
  if (!matched.length) return { found: false, message: 'No cases found for this recipient.' };
  return { found: true, cases: matched.map(sanitizeCase) };
}

function scheduleAppointment(input: Record<string, unknown>, conversation: Conversation): unknown {
  const { caseId, type, preferredDate, location } = input as {
    caseId: string;
    type: 'in_person' | 'phone' | 'video';
    preferredDate?: string;
    location?: string;
  };

  const baseDate = preferredDate ? new Date(preferredDate) : new Date();
  const slot = nextBusinessDay(baseDate);

  const appt: Appointment = {
    appointmentId: uuid(),
    recipientId: conversation.recipientId,
    caseId,
    type,
    location: location ?? (type === 'in_person' ? 'Multnomah County Benefits Office' : undefined),
    scheduledAt: `${slot}T10:00:00`,
    status: 'scheduled',
  };
  appointments.set(appt.appointmentId, appt);

  return {
    success: true,
    appointment: {
      appointmentId: appt.appointmentId,
      type: appt.type,
      location: appt.location,
      scheduledAt: appt.scheduledAt,
      status: appt.status,
    },
  };
}

function nextBusinessDay(from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 2);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function uploadDocument(input: Record<string, unknown>, conversation: Conversation): unknown {
  const { caseId, documentType, mediaUrl } = input as {
    caseId: string;
    documentType: string;
    mediaUrl: string;
  };

  const c = cases.get(caseId);
  if (!c) return { success: false, message: `Case ${caseId} not found.` };

  const remaining = (c.missingDocuments ?? []).filter(
    (doc) => !doc.toLowerCase().includes(documentType.toLowerCase().replace(/_/g, ' ')) &&
             !documentType.toLowerCase().includes(doc.toLowerCase().split('(')[0].trim()),
  );
  c.missingDocuments = remaining;
  c.lastActionDate = new Date().toISOString();

  return {
    success: true,
    documentType,
    caseId,
    remainingDocuments: remaining,
    message:
      remaining.length === 0
        ? 'All required documents have been received! Your case will be reviewed.'
        : `Document received. Still needed: ${remaining.join(', ')}.`,
  };
}

function sendConfirmation(input: Record<string, unknown>, conversation: Conversation): unknown {
  const { subject, body, includeAppointmentDetails } = input as {
    recipientId: string;
    subject: string;
    body: string;
    includeAppointmentDetails?: boolean;
  };

  let emailBody = body;
  if (includeAppointmentDetails) {
    const appt = [...appointments.values()]
      .filter((a) => a.recipientId === conversation.recipientId)
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
    if (appt) {
      emailBody += `\n\n--- Upcoming Appointment ---\nType: ${appt.type}\nDate: ${appt.scheduledAt}\nLocation: ${appt.location ?? 'N/A'}\nStatus: ${appt.status}`;
    }
  }

  // Capture the email to the transcript (what SES would send)
  record({
    direction: 'outbound',
    channel: 'email',
    text: `Subject: ${subject}\n${emailBody}`,
    meta: { to: conversation.channels.find((c) => c.channel === 'email')?.address },
  });

  return { success: true, message: 'Confirmation email sent.' };
}

function escalateToAgent(input: Record<string, unknown>, conversation: Conversation): unknown {
  const { reason } = input as { recipientId: string; reason: string; caseId?: string };
  return {
    success: true,
    message: 'A caseworker has been notified and will reach out within 1 business day.',
    referenceNumber: `ESC-${Date.now()}`,
    reason,
  };
}
