# Configuration Guide

## Prerequisites

1. **AWS Account** with the following services enabled:
   - AWS End User Messaging (EUM)
   - Amazon SES
   - Amazon Bedrock (Claude model access)
   - Amazon DynamoDB
   - AWS Lambda
   - Amazon API Gateway

2. **Node.js 20+** and **npm**

3. **AWS CDK v2** (`npm install -g aws-cdk`)

## Step 1: RCS Agent Provisioning

RCS agents are approved in minutes for testing:

```bash
# Via AWS Console:
# 1. Go to End User Messaging → RCS
# 2. Click "Create RCS agent"
# 3. Fill in: Agent name = "Benefits Concierge", Type = "Test"
# 4. Wait for approval (~5 minutes)

# Note your RCS Agent ID for the .env file
```

### Register Test Devices

Test agents only send to pre-registered devices:

```bash
# In the RCS console:
# 1. Go to your agent → "Test devices"
# 2. Add your phone number
# 3. Accept the tester invitation on your phone (~2-20 minutes)
```

## Step 2: WhatsApp Business Registration

```bash
# Via AWS Console:
# 1. Go to End User Messaging → Social messaging
# 2. Connect your WhatsApp Business Account (WABA)
# 3. Register a phone number for WhatsApp Business
# 4. Note the Phone Number ID and WABA ID for .env
```

## Step 3: SES Domain Verification

```bash
# Verify your sending domain:
aws ses verify-domain-identity --domain yourdomain.com --region us-east-1

# Or verify a single email for testing:
aws ses verify-email-identity --email-address benefits@yourdomain.com --region us-east-1
```

## Step 4: Bedrock Model Access

```bash
# Request access to Claude in the Bedrock console:
# 1. Go to Amazon Bedrock → Model access
# 2. Request access to Anthropic Claude Sonnet
# 3. Wait for approval (usually instant for most models)
```

## Step 5: Deploy

```bash
# Copy and fill in your environment file
cp .env.example .env

# Install dependencies
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy all stacks
npx cdk deploy --all

# Seed demo data
npx ts-node demo/seed-data.ts
```

## Step 6: Configure Webhooks

After deployment, CDK outputs the webhook URLs:

1. **SMS/RCS**: Configure EUM two-way SMS to send SNS notifications to the `/sms` endpoint
2. **WhatsApp**: Configure the WhatsApp webhook URL in your WABA settings to the `/whatsapp` endpoint  
3. **Email**: Configure SES receiving rules to forward to the `/email` endpoint

## Architecture Notes

### Cross-Channel Identity

Recipients are identified by their E.164 phone number. When the same phone texts via SMS, messages via WhatsApp, or replies to an email (encoded as `benefits+{phone}@domain.com`), all messages route to the same conversation record.

### Channel Selection

The Channel Sender picks the optimal channel for each outbound message:
- **Reply on the same channel** the recipient used (immediate context)
- **Proactive outreach** uses SMS (universal) + RCS rich cards (enhanced) + email (detailed)
- **Escalation** can route to Amazon Connect for voice

### Security

- All phone numbers stored in E.164 format
- PII (SSN, DOB) never stored in conversation history — agent is instructed to use last-4 only
- DynamoDB encryption at rest (default)
- API Gateway with throttling
- Lambda execution roles follow least privilege
