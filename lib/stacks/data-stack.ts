import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly conversationTable: dynamodb.Table;
  public readonly caseTable: dynamodb.Table;
  public readonly appointmentTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Conversations ─────────────────────────────────────────────────────
    // PK: recipientId (phone E.164) — one conversation per recipient
    // Cross-channel: the same recipientId resolves whether they text, WhatsApp, or email
    this.conversationTable = new dynamodb.Table(this, 'Conversations', {
      tableName: 'bc-conversations',
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });

    // GSI: look up conversation by sessionId (for webhook correlation)
    this.conversationTable.addGlobalSecondaryIndex({
      indexName: 'by-session',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Cases ─────────────────────────────────────────────────────────────
    // PK: caseId — benefits case record
    this.caseTable = new dynamodb.Table(this, 'Cases', {
      tableName: 'bc-cases',
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI: find all cases for a recipient
    this.caseTable.addGlobalSecondaryIndex({
      indexName: 'by-recipient',
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'lastActionDate', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Appointments ──────────────────────────────────────────────────────
    this.appointmentTable = new dynamodb.Table(this, 'Appointments', {
      tableName: 'bc-appointments',
      partitionKey: { name: 'appointmentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.appointmentTable.addGlobalSecondaryIndex({
      indexName: 'by-recipient',
      partitionKey: { name: 'recipientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.appointmentTable.addGlobalSecondaryIndex({
      indexName: 'by-case',
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ConversationTableName', {
      value: this.conversationTable.tableName,
    });
    new cdk.CfnOutput(this, 'CaseTableName', {
      value: this.caseTable.tableName,
    });
    new cdk.CfnOutput(this, 'AppointmentTableName', {
      value: this.appointmentTable.tableName,
    });
  }
}
