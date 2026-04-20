import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const VALID_STATUSES = ['upcoming', 'completed', 'cancelled'] as const;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const status = (event.queryStringParameters?.['status'] ?? 'upcoming') as string;
  const limit = parseInt(event.queryStringParameters?.['limit'] ?? '20', 10);

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return error('INVALID_STATUS', 'status must be upcoming, completed, or cancelled', 400);
  }

  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `VET#${vetId}`,
        ':sk': `BOOKING#${status}#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  const items = queryResult.Items ?? [];
  if (items.length === 0) return success({ bookings: [] });

  const ownerKeys = [...new Set(items.map((i) => i['ownerId'] as string))].map((id) => ({
    PK: `OWNER#${id}`, SK: 'PROFILE',
  }));
  const dogKeys = [...new Set(items.map((i) => i['dogId'] as string))].map((id) => ({
    PK: `DOG#${id}`, SK: 'PROFILE',
  }));

  const batchResult = await docClient.send(
    new BatchGetCommand({ RequestItems: { [table]: { Keys: [...ownerKeys, ...dogKeys] } } }),
  );

  const profiles = batchResult.Responses?.[table] ?? [];
  const ownerMap = Object.fromEntries(
    profiles.filter((p) => (p['PK'] as string).startsWith('OWNER#')).map((p) => [p['userId'], p]),
  );
  const dogMap = Object.fromEntries(
    profiles.filter((p) => (p['PK'] as string).startsWith('DOG#')).map((p) => [p['dogId'], p]),
  );

  const bookings = items.map((b) => {
    const owner = ownerMap[b['ownerId'] as string];
    const dog = dogMap[b['dogId'] as string];
    return {
      bookingId: b['bookingId'],
      owner: owner ? { userId: owner['userId'], firstName: owner['firstName'], lastName: owner['lastName'] } : null,
      dog: dog
        ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'], ageMonths: dog['ageMonths'], photoUrl: dog['photoUrl'] ?? null }
        : null,
      duration: b['duration'],
      scheduledAt: b['scheduledAt'],
      status: b['status'],
      agoraChannelId: b['agoraChannelId'],
      createdAt: b['createdAt'],
    };
  });

  return success({ bookings });
};
