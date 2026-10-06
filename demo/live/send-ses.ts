/**
 * Live SES send — fires a REAL Benefits Concierge renewal confirmation email
 * through Amazon SES (AWS CDS) using the SAME @aws-sdk/client-sesv2 SendEmailCommand
 * the production channel-sender uses.
 *
 * This is a genuine CDS service call, not a mock. Used to prove end-to-end
 * functionality and to capture footage for the demo video.
 *
 * Usage:
 *   AWS_PROFILE=vf-dev-team5 AWS_REGION=us-east-1 \
 *   SES_FROM=benefits@allstate-team5.email.connect.aws \
 *   SES_TO=<verified-recipient> \
 *   npx ts-node demo/live/send-ses.ts
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { BenefitsCase } from '../../lib/shared/types';

const FROM = process.env.SES_FROM ?? 'benefits@allstate-team5.email.connect.aws';
const TO = process.env.SES_TO;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

if (!TO) {
  console.error('Set SES_TO to a verified recipient email address.');
  process.exit(1);
}

const ses = new SESv2Client({ region: REGION });

// The real demo case — Maria Garcia's SNAP renewal
const demoCase: BenefitsCase = {
  caseId: 'SNAP-2026-04821',
  recipientId: '+15551234567',
  programType: 'snap',
  status: 'pending_renewal',
  recipientName: 'Maria Garcia',
  renewalDeadline: '2026-10-20',
  missingDocuments: ['Proof of Income (pay stubs)', 'Utility Bill'],
  lastActionDate: '2026-09-15',
  nextActionRequired: 'Submit missing documents before renewal deadline',
  caseworkerName: 'Sarah Johnson',
  countyOffice: 'Multnomah County Human Services',
};

// Same HTML structure the proactive-outreach Lambda produces
function buildRenewalEmailHtml(c: BenefitsCase, programName: string, days: number): string {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">🏛️ Benefits Concierge</h1>
      <p style="margin: 8px 0 0; opacity: 0.9;">Your government benefits assistant</p>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
      <p>Hi <strong>${c.recipientName}</strong>,</p>
      <div style="background: ${days <= 7 ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${days <= 7 ? '#ef4444' : '#f59e0b'}; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0; font-weight: bold;">⏰ Your ${programName} renewal is due on ${c.renewalDeadline}<br>
        <span style="font-weight: normal;">(${days} days remaining)</span></p>
      </div>
      <p>Case ID: <strong>${c.caseId}</strong></p>
      <h3>📎 Documents Still Needed</h3>
      <ul>${(c.missingDocuments ?? []).map((d) => `<li>${d}</li>`).join('')}</ul>
      <p>You can submit documents by:</p>
      <ul>
        <li>📱 Texting a photo to this number</li>
        <li>💬 Sending via WhatsApp</li>
        <li>📧 Replying to this email with attachments</li>
      </ul>
      <p>Your caseworker: <strong>${c.caseworkerName}</strong> at ${c.countyOffice}</p>
      <hr style="border-color: #e5e7eb; margin: 24px 0;">
      <p style="color: #6b7280; font-size: 12px;">
        This is an automated message from Benefits Concierge, sent via Amazon SES.
        Reply STOP to unsubscribe from reminders.
      </p>
    </div>
  </div>`;
}

async function main() {
  const programName = 'SNAP';
  const days = Math.ceil((new Date(demoCase.renewalDeadline!).getTime() - Date.now()) / (24 * 3600 * 1000));
  const html = buildRenewalEmailHtml(demoCase, programName, days);
  const text = `${demoCase.recipientName}, your ${programName} renewal is due on ${demoCase.renewalDeadline} (${days} days). Missing documents: ${demoCase.missingDocuments?.join(', ')}. Reply or text us to start your renewal.`;

  console.log(`Sending live SES email: ${FROM} → ${TO} (region ${REGION})`);

  const resp = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [TO!] },
      Content: {
        Simple: {
          Subject: { Data: `Action Required: ${programName} Renewal Due ${demoCase.renewalDeadline}` },
          Body: { Html: { Data: html }, Text: { Data: text } },
        },
      },
    }),
  );

  console.log('✅ SES accepted the message.');
  console.log('   MessageId:', resp.MessageId);
  console.log('   This is a real AWS CDS (SES) send via @aws-sdk/client-sesv2 SendEmailCommand.');
}

main().catch((e) => {
  console.error('❌ SES send failed:', e.name, e.message);
  process.exit(1);
});
