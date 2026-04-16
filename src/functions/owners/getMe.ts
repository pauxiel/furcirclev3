import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const result = await docClient.send(
    new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: [
            { PK: `OWNER#${userId}`, SK: 'PROFILE' },
            { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
          ],
        },
      },
    }),
  );

  const items = result.Responses?.[table] ?? [];
  const profile = items.find((i) => i['SK'] === 'PROFILE');
  const subscription = items.find((i) => i['SK'] === 'SUBSCRIPTION');

  if (!profile) {
    return error('OWNER_NOT_FOUND', 'Owner profile not found', 404);
  }

  return success({
    userId: profile['userId'],
    firstName: profile['firstName'],
    lastName: profile['lastName'],
    email: profile['email'],
    pushToken: profile['pushToken'] ?? null,
    referralCode: profile['referralCode'],
    subscription: subscription
      ? {
          plan: subscription['plan'],
          creditBalance: subscription['creditBalance'],
          status: subscription['status'],
          currentPeriodEnd: subscription['currentPeriodEnd'] ?? null,
        }
      : null,
    createdAt: profile['createdAt'],
  });
};
