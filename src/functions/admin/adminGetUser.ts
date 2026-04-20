import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;
  const userId = event.pathParameters?.['userId'];
  if (!userId) return error('INVALID_REQUEST', 'userId is required', 400);

  const [batchResult, dogsResult] = await Promise.all([
    docClient.send(new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: [
            { PK: `OWNER#${userId}`, SK: 'PROFILE' },
            { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
          ],
        },
      },
    })),
    docClient.send(new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `OWNER#${userId}`, ':prefix': 'DOG#' },
    })),
  ]);

  const items = batchResult.Responses?.[table] ?? [];
  const profile = items.find((i) => i['SK'] === 'PROFILE');
  if (!profile) return error('NOT_FOUND', 'User not found', 404);

  const sub = items.find((i) => i['SK'] === 'SUBSCRIPTION');
  const dogs = (dogsResult.Items ?? []).map((d) => ({
    dogId: d['dogId'],
    name: d['name'],
    breed: d['breed'],
    planStatus: d['planStatus'],
  }));

  return success({
    userId: profile['userId'],
    firstName: profile['firstName'],
    lastName: profile['lastName'],
    email: profile['email'],
    createdAt: profile['createdAt'],
    subscription: sub ? { plan: sub['plan'], creditBalance: sub['creditBalance'], status: sub['status'] } : null,
    dogs,
  });
};
