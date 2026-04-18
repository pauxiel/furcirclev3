import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const assessmentId = event.pathParameters?.['assessmentId'];

  if (!assessmentId) {
    return error('INVALID_REQUEST', 'assessmentId is required', 400);
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `ASSESSMENT#${assessmentId}`, SK: 'ASSESSMENT' },
    }),
  );

  const assessment = result.Item;
  if (!assessment) {
    return error('NOT_FOUND', 'Assessment not found', 404);
  }

  if (assessment['ownerId'] !== userId) {
    return error('FORBIDDEN', 'Access denied', 403);
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
