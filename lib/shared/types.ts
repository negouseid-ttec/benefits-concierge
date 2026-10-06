/**
 * Unified messaging types — the heart of the omnichannel design.
 * All channels normalize to these types, and the agent works exclusively
 * with channel-agnostic representations.
 */

// ─── Channels ───────────────────────────────────────────────────────────────

export type Channel = 'sms' | 'rcs' | 'whatsapp' | 'email';

export interface ChannelAddress {
  channel: Channel;
  /** Phone number (E.164) for sms/rcs/whatsapp, email address for email */
  address: string;
}

// ─── Inbound (normalized from any channel) ──────────────────────────────────

export interface InboundMessage {
  messageId: string;
  channel: Channel;
  /** Sender address — phone (E.164) or email */
  from: string;
  /** Our destination address on that channel */
  to: string;
  /** UTC ISO-8601 */
  timestamp: string;
  /** Text body of the message */
  text: string;
  /** Media attachments (documents, images) */
  media?: MediaAttachment[];
  /** AI categorization (set by the email-categorization Lambda for inbound email) */
  categorization?: EmailCategorization;
  /** Raw channel-specific payload for debugging */
  rawPayload?: unknown;
}

/** AI classification of an inbound email, produced by the email-categorization Lambda. */
export interface EmailCategorization {
  category:
    | 'renewal_question'
    | 'document_submission'
    | 'status_inquiry'
    | 'appointment_request'
    | 'complaint_escalation'
    | 'benefit_change'
    | 'other';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  needsHuman: boolean;
  language: string;
  summary: string;
  suggestedAction: string;
}

export interface MediaAttachment {
  url: string;
  mimeType: string;
  filename?: string;
  sizeBytes?: number;
}

// ─── Outbound (agent decides what, sender decides how) ──────────────────────

export type OutboundMessage = TextMessage | RichCardMessage | CarouselMessage | EmailMessage;

export interface TextMessage {
  type: 'text';
  recipientId: string;
  text: string;
  /** Optional: force a specific channel. Otherwise, sender picks the best. */
  channel?: Channel;
}

export interface RichCardMessage {
  type: 'rich_card';
  recipientId: string;
  title: string;
  description: string;
  imageUrl?: string;
  suggestions: Suggestion[];
  channel?: Channel;
}

export interface CarouselMessage {
  type: 'carousel';
  recipientId: string;
  cards: {
    title: string;
    description: string;
    imageUrl?: string;
    suggestions: Suggestion[];
  }[];
  channel?: Channel;
}

export interface EmailMessage {
  type: 'email';
  recipientId: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

export interface Suggestion {
  text: string;
  postbackData?: string;
  action?: 'reply' | 'url' | 'dial';
  actionData?: string;
}

// ─── Conversation State (DynamoDB) ──────────────────────────────────────────

export interface Conversation {
  /** Stable recipient ID (phone E.164 or hashed identifier) */
  recipientId: string;
  /** Active session ID */
  sessionId: string;
  /** Preferred channel for proactive outreach */
  preferredChannel: Channel;
  /** All known addresses for this recipient */
  channels: ChannelAddress[];
  /** Preferred language (BCP-47) */
  language: string;
  /** Conversation history (last N turns for agent context) */
  history: ConversationTurn[];
  /** Linked case IDs */
  caseIds: string[];
  /** Created ISO-8601 */
  createdAt: string;
  /** Last activity ISO-8601 */
  updatedAt: string;
  /** TTL epoch seconds */
  ttl: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  channel: Channel;
  content: string;
  timestamp: string;
  /** Tool calls the agent made in this turn */
  toolCalls?: ToolCallRecord[];
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output: string;
}

// ─── Case Data (mock/demo) ──────────────────────────────────────────────────

export interface BenefitsCase {
  caseId: string;
  recipientId: string;
  programType: 'snap' | 'medicaid' | 'tanf' | 'childcare' | 'housing';
  status: 'active' | 'pending_renewal' | 'pending_documents' | 'under_review' | 'expired';
  recipientName: string;
  renewalDeadline?: string;
  missingDocuments?: string[];
  lastActionDate: string;
  nextActionRequired?: string;
  caseworkerName?: string;
  caseworkerPhone?: string;
  countyOffice?: string;
}

export interface Appointment {
  appointmentId: string;
  recipientId: string;
  caseId: string;
  type: 'in_person' | 'phone' | 'video';
  location?: string;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  notes?: string;
}

// ─── Agent Tool Definitions ─────────────────────────────────────────────────

export interface AgentToolInput {
  check_case_status: { caseId?: string; recipientId?: string };
  schedule_appointment: {
    caseId: string;
    type: 'in_person' | 'phone' | 'video';
    preferredDate?: string;
    location?: string;
  };
  upload_document: {
    caseId: string;
    documentType: string;
    mediaUrl: string;
  };
  send_confirmation: {
    recipientId: string;
    subject: string;
    body: string;
    includeAppointmentDetails?: boolean;
  };
  escalate_to_agent: {
    recipientId: string;
    reason: string;
    caseId?: string;
  };
}
