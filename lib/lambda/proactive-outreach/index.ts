/**
 * Proactive Outreach — sends renewal reminders and deadline notifications.
 *
 * Triggered on a schedule (EventBridge) or manually via API.
 * Scans for cases with upcoming deadlines and sends channel-appropriate
 * reminders to each recipient via the channel sender.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { BenefitsCase, Conversation, OutboundMessage } from '../../shared/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const CASE_TABLE = process.env.CASE_TABLE!;
const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME!;

export const handler: Handler = async (event) => {
  console.log('[proactive-outreach] Starting outreach scan');

  // Find cases with renewals due in the next 14 days
  const now = new Date();
  const cutoffDate = new Date(now.getTime() + 14 * 24 * 3600 * 1000);

  const result = await ddb.send(
    new ScanCommand({
      TableName: CASE_TABLE,
      FilterExpression: '#status = :pendingRenewal AND renewalDeadline <= :cutoff',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pendingRenewal': 'pending_renewal',
        ':cutoff': cutoffDate.toISOString().split('T')[0],
      },
    }),
  );

  const cases = (result.Items ?? []) as BenefitsCase[];
  console.log(`[proactive-outreach] Found ${cases.length} cases needing outreach`);

  let sent = 0;
  for (const c of cases) {
    try {
      await sendRenewalReminder(c);
      sent++;
    } catch (err) {
      console.error(`[proactive-outreach] Failed for case ${c.caseId}:`, err);
    }
  }

  console.log(`[proactive-outreach] Sent ${sent}/${cases.length} reminders`);
  return { sent, total: cases.length };
};

async function sendRenewalReminder(c: BenefitsCase): Promise<void> {
  // Load or create conversation for this recipient
  const convResult = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_TABLE,
      Key: { recipientId: c.recipientId },
    }),
  );

  const conversation = convResult.Item as Conversation | undefined;
  const preferredChannel = conversation?.preferredChannel ?? 'sms';

  const daysUntilDeadline = Math.ceil(
    (new Date(c.renewalDeadline!).getTime() - Date.now()) / (24 * 3600 * 1000),
  );

  const programName = {
    snap: 'SNAP',
    medicaid: 'Medicaid',
    tanf: 'TANF',
    childcare: 'Childcare Assistance',
    housing: 'Housing Assistance',
  }[c.programType];

  // ── SMS: Short and urgent ─────────────────────────────────────────────
  const smsMessage: OutboundMessage = {
    type: 'text',
    recipientId: c.recipientId,
    text: `${c.recipientName}, your ${programName} renewal is due in ${daysUntilDeadline} days (${c.renewalDeadline}). Reply RENEW to start or HELP for questions.`,
    channel: 'sms',
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(smsMessage)),
    }),
  );

  // ── RCS: Rich card with action buttons ────────────────────────────────
  if (preferredChannel === 'rcs' || preferredChannel === 'sms') {
    const richCard: OutboundMessage = {
      type: 'rich_card',
      recipientId: c.recipientId,
      title: `${programName} Renewal Due`,
      description: `Hi ${c.recipientName}, your ${programName} benefits renewal is due on ${c.renewalDeadline} (${daysUntilDeadline} days).${
        c.missingDocuments?.length
          ? `\n\nDocuments needed:\n• ${c.missingDocuments.join('\n• ')}`
          : '\n\nAll documents are on file.'
      }`,
      suggestions: [
        { text: 'Start Renewal', postbackData: `RENEW_${c.caseId}` },
        { text: 'Upload Documents', postbackData: `UPLOAD_${c.caseId}` },
        { text: 'Schedule Appointment', postbackData: `APPT_${c.caseId}` },
        { text: 'Talk to Someone', postbackData: 'ESCALATE' },
      ],
      channel: 'rcs',
    };

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SENDER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(richCard)),
      }),
    );
  }

  // ── Email: Detailed with all information ──────────────────────────────
  const emailMessage: OutboundMessage = {
    type: 'email',
    recipientId: c.recipientId,
    subject: `Action Required: ${programName} Renewal Due ${c.renewalDeadline}`,
    htmlBody: buildRenewalEmailHtml(c, programName!, daysUntilDeadline),
    textBody: `${c.recipientName}, your ${programName} renewal is due on ${c.renewalDeadline} (${daysUntilDeadline} days). ${
      c.missingDocuments?.length
        ? `Missing documents: ${c.missingDocuments.join(', ')}.`
        : 'All documents on file.'
    } Reply to this email or text us to start your renewal.`,
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(emailMessage)),
    }),
  );

  // Ensure a conversation record exists so replies are routed correctly
  if (!conversation) {
    await ddb.send(
      new PutCommand({
        TableName: CONVERSATION_TABLE,
        Item: {
          recipientId: c.recipientId,
          sessionId: uuid(),
          preferredChannel: 'sms',
          channels: [{ channel: 'sms', address: c.recipientId }],
          language: 'en-US',
          history: [],
          caseIds: [c.caseId],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
        },
      }),
    );
  }
}

function buildRenewalEmailHtml(
  c: BenefitsCase,
  programName: string,
  daysUntilDeadline: number,
): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">🏛️ Benefits Concierge</h1>
      <p style="margin: 8px 0 0; opacity: 0.9;">Your government benefits assistant</p>
    </div>
    
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
      <p>Hi <strong>${c.recipientName}</strong>,</p>
      
      <div style="background: ${daysUntilDeadline <= 7 ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${daysUntilDeadline <= 7 ? '#ef4444' : '#f59e0b'}; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0; font-weight: bold;">
          ⏰ Your ${programName} renewal is due on ${c.renewalDeadline}
          <br><span style="font-weight: normal;">(${daysUntilDeadline} days remaining)</span>
        </p>
      </div>

      <p>Case ID: <strong>${c.caseId}</strong></p>
      
      ${
        c.missingDocuments?.length
          ? `
        <h3>📎 Documents Still Needed</h3>
        <ul>
          ${c.missingDocuments.map((doc) => `<li>${doc}</li>`).join('')}
        </ul>
        <p>You can submit documents by:</p>
        <ul>
          <li>📱 Texting a photo to this number</li>
          <li>💬 Sending via WhatsApp</li>
          <li>📧 Replying to this email with attachments</li>
        </ul>
      `
          : '<p>✅ All required documents are on file.</p>'
      }
      
      <h3>What to Do Next</h3>
      <p>Reply to this email, text us, or message us on WhatsApp to:</p>
      <ul>
        <li>Start your renewal process</li>
        <li>Schedule an appointment at your local office</li>
        <li>Ask any questions about your benefits</li>
      </ul>
      
      ${c.caseworkerName ? `<p>Your caseworker: <strong>${c.caseworkerName}</strong> at ${c.countyOffice ?? 'your local office'}</p>` : ''}
      
      <hr style="border-color: #e5e7eb; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 12px;">
        This is an automated message from Benefits Concierge. 
        Reply STOP to unsubscribe from reminders.
        Text or message us anytime for help with your benefits.
      </p>
    </div>
  </div>`;
}
