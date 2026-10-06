import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/stacks/data-stack';
import { AgentStack } from '../lib/stacks/agent-stack';

describe('Benefits Concierge Infrastructure', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  const dataStack = new DataStack(app, 'TestDataStack', { env });
  const agentStack = new AgentStack(app, 'TestAgentStack', {
    env,
    conversationTable: dataStack.conversationTable,
    caseTable: dataStack.caseTable,
    appointmentTable: dataStack.appointmentTable,
  });

  test('Data stack creates 3 DynamoDB tables', () => {
    const template = Template.fromStack(dataStack);
    template.resourceCountIs('AWS::DynamoDB::Table', 3);
  });

  test('Conversation table has by-session GSI', () => {
    const template = Template.fromStack(dataStack);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'bc-conversations',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'by-session',
          KeySchema: [{ AttributeName: 'sessionId', KeyType: 'HASH' }],
        },
      ],
    });
  });

  test('Case table has by-recipient GSI', () => {
    const template = Template.fromStack(dataStack);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'bc-cases',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'by-recipient',
          KeySchema: [
            { AttributeName: 'recipientId', KeyType: 'HASH' },
            { AttributeName: 'lastActionDate', KeyType: 'RANGE' },
          ],
        },
      ],
    });
  });

  test('Agent stack creates orchestrator, sender, and categorization Lambdas', () => {
    const template = Template.fromStack(agentStack);
    template.resourceCountIs('AWS::Lambda::Function', 3);
  });

  test('Email categorization Lambda has Bedrock access', () => {
    const template = Template.fromStack(agentStack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'bc-email-categorization',
    });
  });

  test('Orchestrator has Bedrock invoke permissions', () => {
    const template = Template.fromStack(agentStack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('Sender has EUM, SES, and Social Messaging permissions', () => {
    const template = Template.fromStack(agentStack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['sms-voice:SendTextMessage']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('All tables use PAY_PER_REQUEST billing', () => {
    const template = Template.fromStack(dataStack);
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const [, resource] of Object.entries(tables)) {
      expect((resource as any).Properties.BillingMode).toBe('PAY_PER_REQUEST');
    }
  });
});
