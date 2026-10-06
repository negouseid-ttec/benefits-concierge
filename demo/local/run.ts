/**
 * Local Demo Runner — plays the full omnichannel benefits-renewal journey
 * entirely offline. No AWS deployment, no phone numbers, no live Bedrock
 * required (set DEMO_LIVE_BEDROCK=1 to use real Bedrock if creds are present).
 *
 * Run:  npm run demo:local
 */

import type { Channel } from '../../lib/shared/types';
import { seed, getConversation, cases, DEMO_PHONE, DEMO_EMAIL } from './store';
import { runAgent } from './agent';
import { record, transcript } from './tools';

// ─── Pretty console ─────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  sms: '\x1b[33m', rcs: '\x1b[34m', whatsapp: '\x1b[32m', email: '\x1b[35m',
  agent: '\x1b[36m', gray: '\x1b[90m',
};

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: '📱 SMS', rcs: '💬 RCS', whatsapp: '📲 WhatsApp', email: '📧 EMAIL',
};
const CHANNEL_COLOR: Record<Channel, string> = {
  sms: C.sms, rcs: C.rcs, whatsapp: C.whatsapp, email: C.email,
};

function banner(text: string) {
  console.log(`\n${C.bold}${'─'.repeat(70)}${C.reset}`);
  console.log(`${C.bold}  ${text}${C.reset}`);
  console.log(`${C.bold}${'─'.repeat(70)}${C.reset}`);
}

function userMsg(channel: Channel, text: string) {
  const col = CHANNEL_COLOR[channel];
  console.log(`\n${col}${CHANNEL_LABEL[channel]}${C.reset} ${C.dim}Maria →${C.reset} ${text}`);
  record({ direction: 'inbound', channel, text });
}

function agentMsg(channel: Channel, text: string, toolCalls: { tool: string }[]) {
  const col = CHANNEL_COLOR[channel];
  if (toolCalls.length) {
    const tools = toolCalls.map((t) => t.tool).join(', ');
    console.log(`${C.gray}   ⚙  agent called: ${tools}${C.reset}`);
  }
  console.log(`${col}${CHANNEL_LABEL[channel]}${C.reset} ${C.agent}🤖 Concierge →${C.reset} ${text}`);
  record({ direction: 'outbound', channel, text });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── The journey ────────────────────────────────────────────────────────────

async function turn(channel: Channel, userText: string, delay = 600) {
  const conv = getConversation(DEMO_PHONE);
  userMsg(channel, userText);
  await sleep(delay);
  const result = await runAgent(conv, userText, channel);
  agentMsg(channel, result.responseText, result.toolCalls);
  await sleep(delay);
}

async function main() {
  const live = process.env.DEMO_LIVE_BEDROCK === '1';
  console.log(`${C.bold}🏛️  BENEFITS CONCIERGE — Local Omnichannel Demo${C.reset}`);
  console.log(`${C.dim}   Agent mode: ${live ? 'LIVE Bedrock' : 'scripted (offline)'} · recipient: Maria Garcia (${DEMO_PHONE})${C.reset}`);

  seed();

  // Show the starting case state
  const snap = cases.get('SNAP-2026-04821')!;
  banner('STARTING STATE');
  console.log(`${C.dim}  SNAP case ${snap.caseId}: ${snap.status}, due ${snap.renewalDeadline}${C.reset}`);
  console.log(`${C.dim}  Missing documents: ${snap.missingDocuments?.join(', ')}${C.reset}`);

  // ── Act 1: Proactive SMS reminder ──────────────────────────────────────
  banner('ACT 1 — Proactive SMS reminder');
  agentMsg(
    'sms',
    `Maria, your SNAP renewal is due in 14 days (Oct 20). Reply RENEW to start or HELP for questions.`,
    [],
  );
  await sleep(600);
  await turn('sms', 'RENEW');

  // ── Act 2: Escalate to RCS rich interaction ────────────────────────────
  banner('ACT 2 — Recipient switches to RCS to see details');
  await turn('rcs', "what documents do I still need?");

  // ── Act 3: Switch to WhatsApp, upload documents ────────────────────────
  banner('ACT 3 — Switches to WhatsApp, uploads documents (cross-channel continuity)');
  await turn('whatsapp', "here's my pay stub [photo attached]");
  await turn('whatsapp', 'and here is my utility bill [photo attached]');

  // ── Act 4: Schedule an appointment ─────────────────────────────────────
  banner('ACT 4 — Schedules a verification appointment');
  await turn('whatsapp', 'can I book an appointment to finish up?');

  // ── Act 5: Later status check on SMS (continuity proof) ─────────────────
  banner('ACT 5 — Days later, a quick SMS status check (same thread, any channel)');
  await turn('sms', "what's my status now?");

  // ── Summary ────────────────────────────────────────────────────────────
  banner('RESULT');
  const finalSnap = cases.get('SNAP-2026-04821')!;
  console.log(`  SNAP missing documents now: ${finalSnap.missingDocuments?.length ? finalSnap.missingDocuments.join(', ') : C.whatsapp + '✅ NONE — all received' + C.reset}`);
  const emails = transcript.filter((t) => t.channel === 'email' && t.direction === 'outbound');
  console.log(`  Confirmation emails sent (SES): ${emails.length}`);
  const channelsUsed = [...new Set(transcript.map((t) => t.channel))];
  console.log(`  Channels exercised: ${channelsUsed.map((c) => CHANNEL_LABEL[c]).join('  ')}`);
  console.log(`  Total messages in unified thread: ${transcript.length}`);

  // Show the last email body (what SES would deliver)
  if (emails.length) {
    banner('SAMPLE SES EMAIL (last confirmation)');
    console.log(`${C.email}To: ${DEMO_EMAIL}${C.reset}`);
    console.log(`${C.dim}${emails[emails.length - 1].text}${C.reset}`);
  }

  console.log(`\n${C.bold}${C.whatsapp}✓ Demo complete — one conversation, four CDS channels, zero handoffs.${C.reset}\n`);
}

main().catch((e) => {
  console.error('Demo failed:', e);
  process.exit(1);
});
