/**
 * Agent Orchestrator — the brain of Benefits Concierge.
 *
 * Receives a normalized InboundMessage from any channel webhook,
 * loads/creates the cross-channel conversation state, calls Bedrock
 * (Claude) with tool definitions, executes tool calls, and dispatches
 * outbound messages via the channel sender.
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { Handler } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import type { InboundMessage, Conversation, ConversationTurn, OutboundMessage, BenefitsCase, Channel } from '../../shared/types';
import { SYSTEM_PROMPT, buildToolConfig } from './prompt';
import { executeToolCall } from './tools';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE!;
const CASE_TABLE = process.env.CASE_TABLE!;
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0';
const SENDER_FUNCTION = process.env.SENDER_FUNCTION_NAME ?? 'bc-channel-sender';
const MAX_HISTORY_TURNS = 20;
const MAX_TOOL_ROUNDS = 5;

export const handler: Handler = async (event) => {
  const message: InboundMessage = event.message ?? event;
  console.log(`[orchestrator] Inbound from ${message.channel}: ${message.from} → "${message.text?.substring(0, 80)}"`);

  // 1. Load or create conversation
  const conversation = await loadOrCreateConversation(message);

  // 2. Append user turn
  const userTurn: ConversationTurn = {
    role: 'user',
    channel: message.channel,
    content: message.text,
    timestamp: message.timestamp,
  };
  conversation.history.push(userTurn);

  // 3. Run the agent loop (Bedrock Converse with tool use)
  const { responseText, toolCalls } = await runAgentLoop(conversation, message);

  // 4. Append assistant turn
  const assistantTurn: ConversationTurn = {
    role: 'assistant',
    channel: message.channel,
    content: responseText,
    timestamp: new Date().toISOString(),
    toolCalls,
  };
  conversation.history.push(assistantTurn);

  // 5. Trim history to last N turns
  if (conversation.history.length > MAX_HISTORY_TURNS) {
    conversation.history = conversation.history.slice(-MAX_HISTORY_TURNS);
  }

  // 6. Save conversation
  await saveConversation(conversation);

  // 7. Send the response back via the best channel
  await sendResponse(conversation, responseText, message.channel);

  return { statusCode: 200, body: 'OK' };
};

// ─── Agent Loop ──────────────────────────────────────────────────────────────

async function runAgentLoop(
  conversation: Conversation,
  inbound: InboundMessage,
): Promise<{ responseText: string; toolCalls: ConversationTurn['toolCalls'] }> {
  const toolConfig = buildToolConfig();
  const allToolCalls: ConversationTurn['toolCalls'] = [];

  // Build message history for Bedrock
  const messages = conversation.history.map((turn) => ({
    role: turn.role as 'user' | 'assistant',
    content: [{ text: turn.content }],
  }));

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const response = await bedrock.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        toolConfig,
        inferenceConfig: {
          maxTokens: 2048,
          temperature: 0.3,
        },
      }),
    );

    const output = response.output!;
    if ('message' in output) {
      const assistantMessage = output.message!;
      messages.push(assistantMessage as any);

      // Check if there are tool use blocks
      const toolUseBlocks = (assistantMessage.content ?? []).filter(
        (block: any) => 'toolUse' in block,
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls — extract the text response
        const textBlock = (assistantMessage.content ?? []).find(
          (block: any) => 'text' in block,
        );
        return {
          responseText: textBlock ? (textBlock as any).text : 'I apologize, I was unable to process your request.',
          toolCalls: allToolCalls,
        };
      }

      // Execute each tool call
      const toolResults: any[] = [];
      for (const block of toolUseBlocks) {
        const toolUse = (block as any).toolUse;
        console.log(`[orchestrator] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input));

        const result = await executeToolCall(toolUse.name, toolUse.input, conversation);
        allToolCalls.push({
          tool: toolUse.name,
          input: toolUse.input,
          output: typeof result === 'string' ? result : JSON.stringify(result),
        });

        toolResults.push({
          toolResult: {
            toolUseId: toolUse.toolUseId,
            content: [{ text: typeof result === 'string' ? result : JSON.stringify(result) }],
          },
        });
      }

      // Feed tool results back
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  return {
    responseText: 'I apologize, I encountered an issue processing your request. Please try again.',
    toolCalls: allToolCalls,
  };
}

// ─── Conversation Persistence ────────────────────────────────────────────────

async function loadOrCreateConversation(message: InboundMessage): Promise<Conversation> {
  const recipientId = message.from; // E.164 phone or email

  const result = await ddb.send(
    new GetCommand({
      TableName: CONVERSATION_TABLE,
      Key: { recipientId },
    }),
  );

  if (result.Item) {
    const conv = result.Item as Conversation;
    // Update channel list if this is a new channel for this recipient
    if (!conv.channels.find((c) => c.channel === message.channel && c.address === message.from)) {
      conv.channels.push({ channel: message.channel, address: message.from });
    }
    conv.updatedAt = new Date().toISOString();
    return conv;
  }

  // New conversation
  const now = new Date();
  return {
    recipientId,
    sessionId: uuid(),
    preferredChannel: message.channel,
    channels: [{ channel: message.channel, address: message.from }],
    language: 'en-US',
    history: [],
    caseIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ttl: Math.floor(now.getTime() / 1000) + 90 * 24 * 3600, // 90 days
  };
}

async function saveConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: CONVERSATION_TABLE,
      Item: conversation,
    }),
  );
}

// ─── Send Response ───────────────────────────────────────────────────────────

async function sendResponse(
  conversation: Conversation,
  text: string,
  inboundChannel: Channel,
): Promise<void> {
  const outbound: OutboundMessage = {
    type: 'text',
    recipientId: conversation.recipientId,
    text,
    channel: inboundChannel, // Reply on the same channel they wrote on
  };

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SENDER_FUNCTION,
      InvocationType: 'Event', // Async — don't block the response
      Payload: Buffer.from(JSON.stringify(outbound)),
    }),
  );
}
