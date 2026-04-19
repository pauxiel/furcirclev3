import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const vetId = event.pathParameters?.['vetId'];

  if (!vetId) {
    return error('INVALID_REQUEST', 'vetId is required', 400);
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `OWNER#${userId}`,
        ':sk': `ASSESSMENT#${vetId}`,
      },
      Limit: 1,
    }),
  );

  const assessment = result.Items?.[0];
  if (!assessment) {
    return error('NOT_FOUND', 'No assessment found for this provider', 404);
  }

  return success({
    assessmentId: assessment['assessmentId'],
    vetId: assessment['vetId'],
    dogId: assessment['dogId'],
    status: assessment['status'],
    description: assessment['description'],
    mediaUrls: assessment['mediaUrls'] ?? [],
    vetResponse: assessment['vetResponse'] ?? null,
    createdAt: assessment['createdAt'],
    reviewedAt: assessment['reviewedAt'] ?? null,
  });
};
