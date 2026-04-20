import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

const cognito = new CognitoIdentityProviderClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;
  const userPoolId = process.env['USER_POOL_ID']!;

  const today = new Date().toISOString().substring(0, 10);
  const todayStart = `${today}T00:00:00Z`;
  const todayEnd = `${today}T23:59:59Z`;

  const [ownersResult, subsResult, bookingsResult] = await Promise.all([
    cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: 'owners' })),
    docClient.send(new ScanCommand({
      TableName: table,
      FilterExpression: 'SK = :sk AND #plan IN (:p1, :p2)',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: { ':sk': 'SUBSCRIPTION', ':p1': 'protector', ':p2': 'proactive' },
      Select: 'COUNT',
    })),
    docClient.send(new ScanCommand({
      TableName: table,
      FilterExpression: 'SK = :sk AND scheduledAt BETWEEN :start AND :end',
      ExpressionAttributeValues: { ':sk': 'BOOKING', ':start': todayStart, ':end': todayEnd },
      Select: 'COUNT',
    })),
  ]);

  return success({
    totalOwners: (ownersResult.Users ?? []).length,
    activeSubscriptions: subsResult.Count ?? 0,
    bookingsToday: bookingsResult.Count ?? 0,
  });
};
