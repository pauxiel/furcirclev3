import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { docClient } from '../../lib/dynamodb';

const cognito = new CognitoIdentityProviderClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

const generateReferralCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { sub, email, given_name, family_name } = event.request.userAttributes;
  const table = process.env['TABLE_NAME']!;
  const now = new Date().toISOString();
  const referralCode = generateReferralCode();

  await Promise.all([
    docClient.send(new PutCommand({
      TableName: table,
      Item: {
        PK: `OWNER#${sub}`,
        SK: 'PROFILE',
        GSI1PK: `EMAIL#${email}`,
        GSI1SK: 'OWNER',
        userId: sub,
        firstName: given_name ?? '',
        lastName: family_name ?? '',
        email,
        pushToken: null,
        referralCode,
        createdAt: now,
        updatedAt: now,
      },
    })),
    docClient.send(new PutCommand({
      TableName: table,
      Item: {
        PK: `OWNER#${sub}`,
        SK: 'SUBSCRIPTION',
        plan: 'welcome',
        creditBalance: 0,
        status: 'active',
        currentPeriodEnd: null,
        createdAt: now,
        updatedAt: now,
      },
    })),
  ]);

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: sub,
    GroupName: 'owners',
  }));

  return event;
};
