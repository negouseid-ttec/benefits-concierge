/**
 * Demo data seeder — populates DynamoDB with realistic case scenarios
 * for the demonstration video.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { BenefitsCase, Appointment, Conversation } from '../lib/shared/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DEMO_PHONE = process.env.DEMO_RECIPIENT_PHONE ?? '+15551234567';
const DEMO_EMAIL = process.env.DEMO_RECIPIENT_EMAIL ?? 'maria.garcia@example.com';

const cases: BenefitsCase[] = [
  {
    caseId: 'SNAP-2026-04821',
    recipientId: DEMO_PHONE,
    programType: 'snap',
    status: 'pending_renewal',
    recipientName: 'Maria Garcia',
    renewalDeadline: '2026-10-20',
    missingDocuments: ['Proof of Income (pay stubs)', 'Utility Bill'],
    lastActionDate: '2026-09-15',
    nextActionRequired: 'Submit missing documents before renewal deadline',
    caseworkerName: 'Sarah Johnson',
    caseworkerPhone: '+15035551000',
    countyOffice: 'Multnomah County Human Services',
  },
  {
    caseId: 'MED-2026-11293',
    recipientId: DEMO_PHONE,
    programType: 'medicaid',
    status: 'active',
    recipientName: 'Maria Garcia',
    renewalDeadline: '2027-03-15',
    missingDocuments: [],
    lastActionDate: '2026-08-01',
    caseworkerName: 'Sarah Johnson',
    countyOffice: 'Multnomah County Human Services',
  },
  {
    caseId: 'CC-2026-07456',
    recipientId: DEMO_PHONE,
    programType: 'childcare',
    status: 'pending_documents',
    recipientName: 'Maria Garcia',
    renewalDeadline: '2026-11-01',
    missingDocuments: ['Childcare provider agreement', 'Work schedule'],
    lastActionDate: '2026-09-28',
    nextActionRequired: 'Submit childcare provider documentation',
    caseworkerName: 'David Kim',
    countyOffice: 'Multnomah County Early Learning Hub',
  },
];

const conversation: Conversation = {
  recipientId: DEMO_PHONE,
  sessionId: 'demo-session-001',
  preferredChannel: 'sms',
  channels: [
    { channel: 'sms', address: DEMO_PHONE },
    { channel: 'whatsapp', address: DEMO_PHONE },
    { channel: 'email', address: DEMO_EMAIL },
  ],
  language: 'en-US',
  history: [],
  caseIds: ['SNAP-2026-04821', 'MED-2026-11293', 'CC-2026-07456'],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
};

async function seed() {
  console.log('Seeding demo data...');

  // Seed cases
  for (const c of cases) {
    await ddb.send(
      new PutCommand({ TableName: 'bc-cases', Item: c }),
    );
    console.log(`  ✓ Case ${c.caseId} (${c.programType})`);
  }

  // Seed conversation
  await ddb.send(
    new PutCommand({ TableName: 'bc-conversations', Item: conversation }),
  );
  console.log(`  ✓ Conversation for ${DEMO_PHONE}`);

  console.log('Done! Demo data seeded.');
  console.log('\nDemo scenario:');
  console.log(`  Recipient: Maria Garcia (${DEMO_PHONE})`);
  console.log('  SNAP renewal due Oct 20 — missing pay stubs + utility bill');
  console.log('  Medicaid active, no action needed');
  console.log('  Childcare pending documents — missing provider agreement');
}

seed().catch(console.error);
