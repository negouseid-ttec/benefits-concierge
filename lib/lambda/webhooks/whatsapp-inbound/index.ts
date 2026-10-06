/**
 * WhatsApp Inbound Webhook — normalizes EUM Social (WhatsApp) events.
 *
 * Handles both:
 * - GET: Meta webhook verification challenge
 * - POST: Incoming WhatsApp messages (text, media, interactive replies)
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage } from '../../../shared/types';

const lambdaClient = new LambdaClient({});
const AGENT_FUNCTION = process.env.AGENT_FUNCTION_NAME!;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'benefits-concierge-verify';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // ── GET: Webhook verification challenge ──────────────────────────────
  if (event.httpMethod === 'GET') {
    const mode = event.queryStringParameters?.['hub.mode'];
    const token = event.queryStringParameters?.['hub.verify_token'];
    const challenge = event.queryStringParameters?.['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[whatsapp-inbound] Webhook verified');
      return { statusCode: 200, body: challenge ?? '' };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── POST: Incoming WhatsApp message ──────────────────────────────────
  try {
    const body = JSON.parse(event.body ?? '{}');

    // WhatsApp Cloud API webhook payload structure
    const entries = body.entry ?? [];
    for (const entry of entries) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const messages = change.value?.messages ?? [];
        for (const msg of messages) {
          const inbound = normalizeWhatsAppMessage(msg, change.value);
          if (!inbound) continue;

          console.log(`[whatsapp-inbound] From ${inbound.from}: "${inbound.text?.substring(0, 60)}"`);

          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: AGENT_FUNCTION,
              InvocationType: 'Event',
              Payload: Buffer.from(JSON.stringify({ message: inbound })),
            }),
          );
        }
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('[whatsapp-inbound] Error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function normalizeWhatsAppMessage(msg: any, value: any): InboundMessage | null {
  const from = msg.from; // WhatsApp phone number (no + prefix)
  const recipientPhone = `+${from}`;

  switch (msg.type) {
    case 'text':
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: msg.text?.body ?? '',
        rawPayload: msg,
      };

    case 'image':
    case 'document':
    case 'video':
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: msg[msg.type]?.caption ?? `[${msg.type} attachment]`,
        media: [
          {
            url: msg[msg.type]?.id ?? '', // WhatsApp media ID — needs download via API
            mimeType: msg[msg.type]?.mime_type ?? 'application/octet-stream',
            filename: msg[msg.type]?.filename,
          },
        ],
        rawPayload: msg,
      };

    case 'interactive':
      // Button reply or list selection
      const interactive = msg.interactive;
      const replyText =
        interactive?.button_reply?.title ??
        interactive?.list_reply?.title ??
        interactive?.button_reply?.id ??
        '';
      return {
        messageId: msg.id ?? uuid(),
        channel: 'whatsapp',
        from: recipientPhone,
        to: value.metadata?.display_phone_number ?? '',
        timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        text: replyText,
        rawPayload: msg,
      };

    default:
      console.log(`[whatsapp-inbound] Unsupported message type: ${msg.type}`);
      return null;
  }
}
