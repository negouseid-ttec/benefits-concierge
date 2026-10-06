#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/stacks/data-stack';
import { AgentStack } from '../lib/stacks/agent-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { WhatsAppStack } from '../lib/stacks/whatsapp-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
};

// Data layer — DynamoDB tables for conversations, cases, and appointments
const dataStack = new DataStack(app, 'BenefitsConcierge-Data', { env });

// Agent layer — Bedrock agent orchestrator + tool Lambdas
const agentStack = new AgentStack(app, 'BenefitsConcierge-Agent', {
  env,
  conversationTable: dataStack.conversationTable,
  caseTable: dataStack.caseTable,
  appointmentTable: dataStack.appointmentTable,
});

// Messaging layer — EUM (SMS/RCS) + SES inbound/outbound
new MessagingStack(app, 'BenefitsConcierge-Messaging', {
  env,
  agentFunction: agentStack.orchestratorFunction,
  senderFunction: agentStack.senderFunction,
  conversationTable: dataStack.conversationTable,
});

// WhatsApp layer — EUM Social webhook + outbound
new WhatsAppStack(app, 'BenefitsConcierge-WhatsApp', {
  env,
  agentFunction: agentStack.orchestratorFunction,
  senderFunction: agentStack.senderFunction,
  conversationTable: dataStack.conversationTable,
});

app.synth();
