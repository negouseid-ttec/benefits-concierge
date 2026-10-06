/**
 * Agent prompt and Bedrock Converse tool configuration.
 *
 * The system prompt defines the Benefits Concierge persona and behavior.
 * Tool definitions tell Bedrock what actions the agent can take.
 */

import type { Tool, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';

export const SYSTEM_PROMPT = `You are Benefits Concierge, an AI assistant for government benefits programs (SNAP, Medicaid, TANF, childcare assistance, housing).

## Your Role
You help benefits recipients with:
- Checking the status of their cases and renewals
- Understanding what documents are needed and how to submit them
- Scheduling appointments at their local county office
- Answering questions about program requirements and deadlines
- Sending confirmation emails with next steps

## Communication Style
- Warm, patient, and clear — many recipients are stressed or confused
- Use simple language (8th grade reading level)
- Be specific: give dates, names, and concrete next steps
- If the recipient writes in Spanish or another language, respond in that language
- Keep messages short for SMS/RCS (under 160 chars when possible)
- For complex information, offer to send a detailed email

## Behavior Rules
- ALWAYS check the case status before answering case-specific questions
- If you don't have enough information, ask ONE clear question
- When documents are needed, explain exactly what's acceptable (photo of ID, utility bill, etc.)
- For appointment scheduling, offer 2-3 options and confirm the choice
- After completing any action, send a confirmation email with all details
- If a question is beyond your capability, offer to connect them with their caseworker
- NEVER fabricate case information — only report what the tools return
- Protect PII — never repeat full SSN, only last 4 digits

## Channel Awareness
You're speaking across SMS, RCS, WhatsApp, and email. Adapt:
- SMS: Very short, one key point per message, use abbreviations
- RCS: You can use rich cards and suggestion chips — use them for choices
- WhatsApp: Conversational, can use formatting (*bold*, _italic_), media
- Email: Detailed, structured, include all relevant information

## Current Context
The recipient's conversation history spans all channels. You can see which channel each message came from. Always pick up where the conversation left off regardless of channel switch.`;

export function buildToolConfig(): ToolConfiguration {
  return {
    tools: [
      {
        toolSpec: {
          name: 'check_case_status',
          description:
            'Look up the status of a benefits case. Can search by case ID or by the recipient\'s phone number/ID to find all their cases. Returns case details including program type, status, renewal deadline, missing documents, and assigned caseworker.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                caseId: {
                  type: 'string',
                  description: 'The specific case ID to look up (e.g., "SNAP-2024-00123")',
                },
                recipientId: {
                  type: 'string',
                  description: 'The recipient\'s phone number (E.164) to find all their cases',
                },
              },
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'schedule_appointment',
          description:
            'Schedule an appointment at the county benefits office. Can be in-person, phone, or video. Returns the confirmed appointment details.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                caseId: {
                  type: 'string',
                  description: 'The case ID this appointment is for',
                },
                type: {
                  type: 'string',
                  enum: ['in_person', 'phone', 'video'],
                  description: 'Type of appointment',
                },
                preferredDate: {
                  type: 'string',
                  description: 'Preferred date in YYYY-MM-DD format',
                },
                location: {
                  type: 'string',
                  description: 'Preferred office location (for in-person)',
                },
              },
              required: ['caseId', 'type'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'upload_document',
          description:
            'Record a document upload from the recipient (photo of ID, pay stub, utility bill, etc.). The media URL comes from their WhatsApp/RCS message attachment.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                caseId: {
                  type: 'string',
                  description: 'The case ID this document is for',
                },
                documentType: {
                  type: 'string',
                  description: 'Type of document (e.g., "photo_id", "proof_of_income", "utility_bill", "lease_agreement")',
                },
                mediaUrl: {
                  type: 'string',
                  description: 'URL of the uploaded media from the messaging channel',
                },
              },
              required: ['caseId', 'documentType', 'mediaUrl'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'send_confirmation',
          description:
            'Send a detailed confirmation email to the recipient with all information about their case, appointment, or document submission. Use this after completing any significant action.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                recipientId: {
                  type: 'string',
                  description: 'The recipient\'s ID (phone number or email)',
                },
                subject: {
                  type: 'string',
                  description: 'Email subject line',
                },
                body: {
                  type: 'string',
                  description: 'Email body content (can include HTML for formatting)',
                },
                includeAppointmentDetails: {
                  type: 'boolean',
                  description: 'Whether to include upcoming appointment details in the email',
                },
              },
              required: ['recipientId', 'subject', 'body'],
            },
          },
        },
      },
      {
        toolSpec: {
          name: 'escalate_to_agent',
          description:
            'Escalate the conversation to a human caseworker when the recipient\'s question is beyond AI capability, when they request to speak to a person, or when a sensitive situation requires human judgment.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                recipientId: {
                  type: 'string',
                  description: 'The recipient\'s ID',
                },
                reason: {
                  type: 'string',
                  description: 'Why this conversation needs a human caseworker',
                },
                caseId: {
                  type: 'string',
                  description: 'Related case ID if applicable',
                },
              },
              required: ['recipientId', 'reason'],
            },
          },
        },
      },
    ] as Tool[],
  };
}
