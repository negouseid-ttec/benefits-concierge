/**
 * Tool implementations — executed when the Bedrock agent calls a tool.
 *
 * Each tool reads/writes DynamoDB and returns structured results
 * that the agent uses to formulate its response.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuid } from 'uuid';
import type { Conversation, BenefitsCase, Appointment } from '../../shared/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const CASE_TABLE = process.env.CASE_TABLE!;
const APPOINTMENT_TABLE = process.env.APPOINTMENT_TABLE!;
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'bc-channel-sender';

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

// ─── check_case_status ──────────────────────────────────────────────────────

async function checkCaseStatus(
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  const { caseId, recipientId } = input as { caseId?: string; recipientId?: string };

  if (caseId) {
    // Direct case lookup
    const result = await ddb.send(
      new GetCommand({ TableName: CASE_TABLE, Key: { caseId } }),
    );
    if (!result.Item) {
      return { found: false, message: `No case found with ID ${caseId}. Please verify the case number.` };
    }
    return { found: true, case: sanitizeCase(result.Item as BenefitsCase) };
  }

  // Look up by recipient
  const lookupId = recipientId ?? conversation.recipientId;
  const result = await ddb.send(
    new QueryCommand({
      TableName: CASE_TABLE,
      IndexName: 'by-recipient',
      KeyConditionExpression: 'recipientId = :rid',
      ExpressionAttributeValues: { ':rid': lookupId },
      ScanIndexForward: false, // newest first
    }),
  );

  if (!result.Items?.length) {
    return { found: false, message: 'No cases found for this recipient.' };
  }

  return {
    found: true,
    cases: result.Items.map((item) => sanitizeCase(item as BenefitsCase)),
  };
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

// ─── schedule_appointment ───────────────────────────────────────────────────

async function scheduleAppointment(
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  const { caseId, type, preferredDate, location } = input as {
    caseId: string;
    type: 'in_person' | 'phone' | 'video';
    preferredDate?: string;
    location?: string;
  };

  // Generate available slots (mock — in production, this queries a scheduling system)
  const baseDate = preferredDate ? new Date(preferredDate) : new Date();
  const slots = generateAvailableSlots(baseDate, type, location);

  // Create the appointment with the first available slot
  const appointment: Appointment = {
    appointmentId: uuid(),
    recipientId: conversation.recipientId,
    caseId,
    type,
    location: location ?? (type === 'in_person' ? 'Multnomah County Benefits Office' : undefined),
    scheduledAt: slots[0].dateTime,
    status: 'scheduled',
    notes: `Scheduled via Benefits Concierge on ${new Date().toISOString()}`,
  };

  await ddb.send(
    new PutCommand({ TableName: APPOINTMENT_TABLE, Item: appointment }),
  );

  return {
    success: true,
    appointment: {
      appointmentId: appointment.appointmentId,
      type: appointment.type,
      location: appointment.location,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
    },
    alternateSlots: slots.slice(1, 3), // Offer 2 alternatives
  };
}

function generateAvailableSlots(baseDate: Date, type: string, location?: string) {
  const slots = [];
  const d = new Date(baseDate);
  // Skip to next business day
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);

  for (let i = 0; i < 5; i++) {
    const slotDate = new Date(d);
    slotDate.setDate(slotDate.getDate() + i);
    // Skip weekends
    while (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
      slotDate.setDate(slotDate.getDate() + 1);
    }
    slots.push({
      dateTime: slotDate.toISOString().split('T')[0] + 'T10:00:00',
      location: location ?? 'Multnomah County Benefits Office',
    });
    slots.push({
      dateTime: slotDate.toISOString().split('T')[0] + 'T14:00:00',
      location: location ?? 'Multnomah County Benefits Office',
    });
  }
  return slots;
}

// ─── upload_document ────────────────────────────────────────────────────────

async function uploadDocument(
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  const { caseId, documentType, mediaUrl } = input as {
    caseId: string;
    documentType: string;
    mediaUrl: string;
  };

  // Record the upload and update the case's missing documents list
  const result = await ddb.send(
    new GetCommand({ TableName: CASE_TABLE, Key: { caseId } }),
  );

  if (!result.Item) {
    return { success: false, message: `Case ${caseId} not found.` };
  }

  const caseData = result.Item as BenefitsCase;
  const remaining = (caseData.missingDocuments ?? []).filter(
    (doc) => doc.toLowerCase() !== documentType.toLowerCase(),
  );

  await ddb.send(
    new UpdateCommand({
      TableName: CASE_TABLE,
      Key: { caseId },
      UpdateExpression: 'SET missingDocuments = :docs, lastActionDate = :now',
      ExpressionAttributeValues: {
        ':docs': remaining,
        ':now': new Date().toISOString(),
      },
    }),
  );

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

// ─── send_confirmation ──────────────────────────────────────────────────────

async function sendConfirmation(
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  const { recipientId, subject, body, includeAppointmentDetails } = input as {
    recipientId: string;
    subject: string;
    body: string;
    includeAppointmentDetails?: boolean;
  };

  let emailBody = body;

  if (includeAppointmentDetails) {
    // Fetch upcoming appointments
    const result = await ddb.send(
      new QueryCommand({
        TableName: APPOINTMENT_TABLE,
        IndexName: 'by-recipient',
        KeyConditionExpression: 'recipientId = :rid',
        ExpressionAttributeValues: { ':rid': recipientId ?? conversation.recipientId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    if (result.Items?.length) {
      const appt = result.Items[0] as Appointment;
      emailBody += `\n\n--- Upcoming Appointment ---\nType: ${appt.type}\nDate: ${appt.scheduledAt}\nLocation: ${appt.location ?? 'N/A'}\nStatus: ${appt.status}`;
    }
  }

  // Dispatch email via the channel sender
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(
        JSON.stringify({
          type: 'email',
          recipientId: recipientId ?? conversation.recipientId,
          subject,
          htmlBody: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Benefits Concierge</h2>
            <div>${emailBody.replace(/\n/g, '<br>')}</div>
            <hr style="margin-top: 24px; border-color: #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px;">
              This is an automated message from Benefits Concierge.
              Reply to this email or text us to continue your conversation.
            </p>
          </div>`,
          textBody: emailBody,
        }),
      ),
    }),
  );

  return { success: true, message: 'Confirmation email sent.' };
}

// ─── escalate_to_agent ──────────────────────────────────────────────────────

async function escalateToAgent(
  input: Record<string, unknown>,
  conversation: Conversation,
): Promise<unknown> {
  const { recipientId, reason, caseId } = input as {
    recipientId: string;
    reason: string;
    caseId?: string;
  };

  // In production, this would create a queue item or transfer to Connect
  console.log(`[escalate] Recipient ${recipientId} escalated: ${reason}`);

  return {
    success: true,
    message: 'A caseworker has been notified and will reach out within 1 business day.',
    referenceNumber: `ESC-${Date.now()}`,
    reason,
  };
}
