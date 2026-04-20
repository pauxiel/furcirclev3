import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;

  const result = await docClient.send(new ScanCommand({
    TableName: table,
    FilterExpression: 'begins_with(PK, :prefix) AND SK IN (:profile, :sub)',
    ExpressionAttributeValues: { ':prefix': 'OWNER#', ':profile': 'PROFILE', ':sub': 'SUBSCRIPTION' },
  }));

  const items = result.Items ?? [];
  const profiles = items.filter((i) => i['SK'] === 'PROFILE');
  const subMap = new Map(items.filter((i) => i['SK'] === 'SUBSCRIPTION').map((i) => [i['PK'] as string, i]));

  const users = profiles.map((p) => {
    const sub = subMap.get(p['PK'] as string);
    return {
      userId: p['userId'],
      firstName: p['firstName'],
      lastName: p['lastName'],
      email: p['email'],
      createdAt: p['createdAt'],
      subscription: sub ? { plan: sub['plan'], creditBalance: sub['creditBalance'], status: sub['status'] } : null,
    };
  });

  return success({ users });
};
