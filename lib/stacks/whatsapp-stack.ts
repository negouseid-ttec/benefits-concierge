import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WhatsAppStackProps extends cdk.StackProps {
  agentFunction: lambda.Function;
  senderFunction: lambda.Function;
  conversationTable: dynamodb.Table;
}

export class WhatsAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WhatsAppStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, '..', 'lambda');

    // ── WhatsApp Inbound Webhook ──────────────────────────────────────────
    // EUM Social delivers WhatsApp messages via EventBridge or SNS.
    // This Lambda normalizes WhatsApp-specific payloads (text, media,
    // interactive replies) to our unified InboundMessage type.
    const whatsappInboundFn = new nodejs.NodejsFunction(this, 'WhatsAppInbound', {
      functionName: 'bc-whatsapp-inbound',
      entry: path.join(lambdaDir, 'webhooks', 'whatsapp-inbound', 'index.ts'),
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

    props.agentFunction.grantInvoke(whatsappInboundFn);
    props.conversationTable.grantReadWriteData(whatsappInboundFn);

    // WhatsApp media download permission
    whatsappInboundFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['social-messaging:GetWhatsAppMessageMedia'],
        resources: ['*'],
      }),
    );

    // API Gateway for WhatsApp webhook (separate from SMS/RCS for clarity)
    const whatsappApi = new apigateway.RestApi(this, 'WhatsAppWebhookApi', {
      restApiName: 'benefits-concierge-whatsapp',
      description: 'WhatsApp inbound message webhook via EUM Social',
      deployOptions: { stageName: 'v1' },
    });

    const whatsappResource = whatsappApi.root.addResource('whatsapp');
    whatsappResource.addMethod('POST', new apigateway.LambdaIntegration(whatsappInboundFn));

    // WhatsApp webhook verification (GET for Meta challenge verification)
    whatsappResource.addMethod('GET', new apigateway.LambdaIntegration(whatsappInboundFn));

    // ── Outputs ────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WhatsAppWebhookUrl', {
      value: whatsappApi.url + 'whatsapp',
    });
  }
}
