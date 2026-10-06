/**
 * Live SMS send — fires a REAL Benefits Concierge renewal reminder through
 * AWS End User Messaging (EUM) via @aws-sdk/client-pinpoint-sms-voice-v2
 * SendTextMessageCommand — the same client/command the production
 * channel-sender uses.
 *
 * In a SANDBOX account this targets the EUM SMS SIMULATOR destination, which
 * accepts the message and returns a real MessageId without carrier delivery.
 * The SDK call path is identical to a production send; only the destination
 * differs. Swap SMS_TO to a verified sandbox number (or any number once the
 * account exits sandbox) to deliver to a physical phone.
 *
 * Usage:
 *   AWS_PROFILE=vf-dev-team5 AWS_REGION=us-east-1 \
 *   SMS_FROM_POOL=pool-xxxx \
 *   SMS_TO=+14255550100 \
 *   npx ts-node demo/live/send-sms.ts
 */

import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
// EUM SMS simulator "success" destination (AWS magic number for sandbox testing)
const TO = process.env.SMS_TO ?? '+14255550100';
// Origination identity: a pool id, phone number id, or phone number (E.164)
const FROM = process.env.SMS_FROM_POOL;

const client = new PinpointSMSVoiceV2Client({ region: REGION });

async function main() {
  const body =
    'Benefits Concierge: Maria, your SNAP renewal is due 10/20 (14 days). ' +
    'Reply RENEW to start or HELP for questions.';

  console.log(`Sending live SMS via EUM: ${FROM ?? '(default sender)'} → ${TO} (region ${REGION})`);

  const resp = await client.send(
    new SendTextMessageCommand({
      DestinationPhoneNumber: TO,
      ...(FROM ? { OriginationIdentity: FROM } : {}),
      MessageBody: body,
      MessageType: 'TRANSACTIONAL',
    }),
  );

  console.log('✅ EUM accepted the message.');
  console.log('   MessageId:', resp.MessageId);
  console.log('   Real AWS CDS (EUM) send via @aws-sdk/client-pinpoint-sms-voice-v2 SendTextMessageCommand.');
}

main().catch((e) => {
  console.error('❌ EUM SMS send failed:', e.name, '-', e.message);
  process.exit(1);
});
