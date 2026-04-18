import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const params = event.queryStringParameters ?? {};
  const status = params['status'];
  const limit = Math.min(parseInt(params['limit'] ?? '20', 10), 50);

  const statusPrefix = status === 'upcoming' ? 'BOOKING#upcoming' : status === 'past' ? 'BOOKING#completed' : 'BOOKING#';

  const result = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `OWNER#${userId}`,
        ':prefix': statusPrefix,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  const bookings = result.Items ?? [];

  if (bookings.length === 0) {
    return success({ bookings: [] });
  }

  const batchKeys = bookings.flatMap((b) => [
    { PK: `VET#${b['vetId'] as string}`, SK: 'PROFILE' },
    { PK: `DOG#${b['dogId'] as string}`, SK: 'PROFILE' },
  ]);

  const batchResult = await docClient.send(
    new BatchGetCommand({ RequestItems: { [table]: { Keys: batchKeys } } }),
  );

  const batchItems = (batchResult.Responses?.[table] ?? []) as Record<string, unknown>[];
  const getProfile = (pk: string) => batchItems.find((i) => i['PK'] === pk) ?? null;

  const assembled = bookings.map((b) => {
    const vet = getProfile(`VET#${b['vetId'] as string}`);
    const dog = getProfile(`DOG#${b['dogId'] as string}`);
    return {
      bookingId: b['bookingId'],
      vet: vet ? { vetId: vet['vetId'], firstName: vet['firstName'], lastName: vet['lastName'], providerType: vet['providerType'], photoUrl: vet['photoUrl'] ?? null } : null,
      dog: dog ? { dogId: dog['dogId'], name: dog['name'] } : null,
      duration: b['duration'],
      scheduledAt: b['scheduledAt'],
      status: b['status'],
      creditsDeducted: b['creditsDeducted'],
      createdAt: b['createdAt'],
    };
  });

  return success({ bookings: assembled });
};
