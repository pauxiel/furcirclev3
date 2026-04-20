import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const VALID_STATUSES = ['pending', 'approved', 'rejected'] as const;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const status = (event.queryStringParameters?.['status'] ?? 'pending') as string;
  const limit = parseInt(event.queryStringParameters?.['limit'] ?? '20', 10);

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return error('INVALID_STATUS', 'status must be pending, approved, or rejected', 400);
  }

  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `VET#${vetId}`,
        ':sk': `ASSESSMENT#${status}#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  const items = queryResult.Items ?? [];
  if (items.length === 0) return success({ assessments: [] });

  const ownerKeys = [...new Set(items.map((i) => i['ownerId'] as string))].map((id) => ({
    PK: `OWNER#${id}`,
    SK: 'PROFILE',
  }));
  const dogKeys = [...new Set(items.map((i) => i['dogId'] as string))].map((id) => ({
    PK: `DOG#${id}`,
    SK: 'PROFILE',
  }));

  const batchResult = await docClient.send(
    new BatchGetCommand({ RequestItems: { [table]: { Keys: [...ownerKeys, ...dogKeys] } } }),
  );

  const profiles = batchResult.Responses?.[table] ?? [];
  const ownerMap = Object.fromEntries(
    profiles.filter((p) => p['SK'] === 'PROFILE' && (p['PK'] as string).startsWith('OWNER#')).map((p) => [p['userId'], p]),
  );
  const dogMap = Object.fromEntries(
    profiles.filter((p) => p['SK'] === 'PROFILE' && (p['PK'] as string).startsWith('DOG#')).map((p) => [p['dogId'], p]),
  );

  const now = Date.now();
  const assessments = items.map((a) => {
    const owner = ownerMap[a['ownerId'] as string];
    const dog = dogMap[a['dogId'] as string];
    const hoursOld = Math.floor((now - new Date(a['createdAt'] as string).getTime()) / 3600000);
    return {
      assessmentId: a['assessmentId'],
      owner: owner ? { firstName: owner['firstName'], lastName: owner['lastName'] } : null,
      dog: dog
        ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'], ageMonths: dog['ageMonths'] }
        : null,
      description: a['description'],
      mediaUrls: a['mediaUrls'] ?? [],
      status: a['status'],
      createdAt: a['createdAt'],
      hoursOld,
    };
  });

  return success({ assessments });
};
