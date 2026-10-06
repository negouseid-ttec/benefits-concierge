import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MessagingStackProps extends cdk.StackProps {
  agentFunction: lambda.Function;
  senderFunction: lambda.Function;
  conversationTable: dynamodb.Table;
}

export class MessagingStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambda');

    // ── API Gateway ────────────────────────────────────────────────────────
    this.api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: 'benefits-concierge-webhooks',
      description: 'Inbound message webhooks for SMS, RCS, and email channels',
      deployOptions: {
        stageName: 'v1',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // ── SMS/RCS Inbound Webhook ────────────────────────────────────────────
    // EUM delivers inbound SMS/RCS via SNS → this Lambda normalizes and
    // forwards to the agent orchestrator.
    const smsInboundFn = new nodejs.NodejsFunction(this, 'SmsRcsInbound', {
      functionName: 'bc-sms-rcs-inbound',
      entry: path.join(lambdaDir, 'webhooks', 'sms-rcs-inbound', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        AGENT_FUNCTION_NAME: props.agentFunction.functionName,
        CONVERSATION_TABLE: props.conversationTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    props.agentFunction.grantInvoke(smsInboundFn);
    props.conversationTable.grantReadWriteData(smsInboundFn);

    const smsResource = this.api.root.addResource('sms');
    smsResource.addMethod('POST', new apigateway.LambdaIntegration(smsInboundFn));

    // ── SES Inbound (email reply handling) ─────────────────────────────────
    const emailInboundFn = new nodejs.NodejsFunction(this, 'EmailInbound', {
      functionName: 'bc-email-inbound',
      entry: path.join(lambdaDir, 'webhooks', 'email-inbound', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        AGENT_FUNCTION_NAME: props.agentFunction.functionName,
        CONVERSATION_TABLE: props.conversationTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    props.agentFunction.grantInvoke(emailInboundFn);
    props.conversationTable.grantReadWriteData(emailInboundFn);

    const emailResource = this.api.root.addResource('email');
    emailResource.addMethod('POST', new apigateway.LambdaIntegration(emailInboundFn));

    // ── Proactive Outreach Trigger ─────────────────────────────────────────
    // Manual/scheduled endpoint to trigger proactive outreach (renewal reminders)
    const outreachFn = new nodejs.NodejsFunction(this, 'ProactiveOutreach', {
      functionName: 'bc-proactive-outreach',
      entry: path.join(lambdaDir, 'proactive-outreach', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      environment: {
        SENDER_FUNCTION_NAME: props.senderFunction.functionName,
        CONVERSATION_TABLE: props.conversationTable.tableName,
        CASE_TABLE: 'bc-cases',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
      },
    });

    props.senderFunction.grantInvoke(outreachFn);
    props.conversationTable.grantReadWriteData(outreachFn);

    const outreachResource = this.api.root.addResource('outreach');
    outreachResource.addMethod('POST', new apigateway.LambdaIntegration(outreachFn), {
      apiKeyRequired: true, // Protect the proactive trigger
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WebhookApiUrl', {
      value: this.api.url,
    });
  }
}
