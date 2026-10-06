/**
 * In-memory data store for the local demo harness.
 *
 * Mirrors the DynamoDB tables (cases, appointments, conversations) so the
 * full agent flow runs offline with no AWS data-plane dependency.
 * Seeded with the same demo scenario as demo/seed-data.ts.
 */

import { v4 as uuid } from 'uuid';
import type { BenefitsCase, Appointment, Conversation } from '../../lib/shared/types';

export const DEMO_PHONE = '+15551234567';
export const DEMO_EMAIL = 'maria.garcia@example.com';

export const cases = new Map<string, BenefitsCase>();
export const appointments = new Map<string, Appointment>();
export const conversations = new Map<string, Conversation>();

export function seed(): void {
  const seedCases: BenefitsCase[] = [
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

  for (const c of seedCases) cases.set(c.caseId, c);

  conversations.set(DEMO_PHONE, {
    recipientId: DEMO_PHONE,
    sessionId: uuid(),
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
  });
}

export function getConversation(recipientId: string): Conversation {
  let conv = conversations.get(recipientId);
  if (!conv) {
    conv = {
      recipientId,
      sessionId: uuid(),
      preferredChannel: 'sms',
      channels: [{ channel: 'sms', address: recipientId }],
      language: 'en-US',
      history: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 3600,
    };
    conversations.set(recipientId, conv);
  }
  return conv;
}
