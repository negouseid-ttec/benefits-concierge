import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface AgentStackProps extends cdk.StackProps {
  conversationTable: dynamodb.Table;
  caseTable: dynamodb.Table;
  appointmentTable: dynamodb.Table;
}

export class AgentStack extends cdk.Stack {
  public readonly orchestratorFunction: lambda.Function;
  public readonly senderFunction: lambda.Function;
  public readonly categorizationFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambda');

    const sharedEnv = {
      CONVERSATION_TABLE: props.conversationTable.tableName,
      CASE_TABLE: props.caseTable.tableName,
      APPOINTMENT_TABLE: props.appointmentTable.tableName,
      BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-20250514-v1:0',
      NODE_OPTIONS: '--enable-source-maps',
    };

    // ── Agent Orchestrator ─────────────────────────────────────────────────
    // The brain: receives a normalized inbound message, loads conversation
    // state, calls Bedrock with tools, and dispatches outbound messages.
    this.orchestratorFunction = new nodejs.NodejsFunction(this, 'Orchestrator', {
      functionName: 'bc-agent-orchestrator',
      entry: path.join(lambdaDir, 'agent-orchestrator', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      environment: sharedEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    // Bedrock invoke permission
    this.orchestratorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'], // Model ARNs are region-specific and model-specific
      }),
    );

    // DynamoDB permissions
    props.conversationTable.grantReadWriteData(this.orchestratorFunction);
    props.caseTable.grantReadData(this.orchestratorFunction);
    props.appointmentTable.grantReadWriteData(this.orchestratorFunction);

    // ── Email Categorization (inbound intelligence) ────────────────────────
    // Classifies inbound email intent + urgency with Bedrock BEFORE routing to
    // the agent. Mirrors AWS's "Email Categorization" reference sample.
    this.categorizationFunction = new nodejs.NodejsFunction(this, 'EmailCategorization', {
      functionName: 'bc-email-categorization',
      entry: path.join(lambdaDir, 'email-categorization', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        BEDROCK_MODEL_ID: sharedEnv.BEDROCK_MODEL_ID,
        AGENT_FUNCTION_NAME: this.orchestratorFunction.functionName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    this.categorizationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    this.orchestratorFunction.grantInvoke(this.categorizationFunction);

    // ── Channel Sender ─────────────────────────────────────────────────────
    // Takes an outbound message and routes it to the best channel:
    // SMS (EUM), RCS (EUM), WhatsApp (EUM Social), or Email (SES).
    this.senderFunction = new nodejs.NodejsFunction(this, 'ChannelSender', {
      functionName: 'bc-channel-sender',
      entry: path.join(lambdaDir, 'channel-sender', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...sharedEnv,
        SES_FROM_EMAIL: process.env.SES_FROM_EMAIL ?? 'benefits@example.com',
        EUM_PHONE_POOL_ID: process.env.EUM_PHONE_POOL_ID ?? '',
        RCS_AGENT_ID: process.env.RCS_AGENT_ID ?? '',
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    // EUM permissions (SMS + RCS)
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'sms-voice:SendTextMessage',
          'sms-voice:SendRcsMessage',
          'sms-voice:SendMediaMessage',
        ],
        resources: ['*'],
      }),
    );

    // EUM Social permissions (WhatsApp)
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'social-messaging:SendWhatsAppMessage',
          'social-messaging:GetWhatsAppMessageMedia',
        ],
        resources: ['*'],
      }),
    );

    // SES permissions (Email)
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    // Conversation table read (for channel preference lookups)
    props.conversationTable.grantReadData(this.senderFunction);

    // Allow the orchestrator to invoke the sender
    this.senderFunction.grantInvoke(this.orchestratorFunction);

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OrchestratorFunctionArn', {
      value: this.orchestratorFunction.functionArn,
    });
    new cdk.CfnOutput(this, 'SenderFunctionArn', {
      value: this.senderFunction.functionArn,
    });
  }
}
