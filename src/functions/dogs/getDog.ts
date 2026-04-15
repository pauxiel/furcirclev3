import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const { Items: healthRecords = [] } = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `DOG#${dogId}`, ':prefix': 'HEALTH#' },
    }),
  );

  return success({
    dogId: dog['dogId'],
    ownerId: dog['ownerId'],
    name: dog['name'],
    breed: dog['breed'],
    ageMonths: dog['ageMonths'],
    dateOfBirth: dog['dateOfBirth'] ?? null,
    spayedNeutered: dog['spayedNeutered'] ?? null,
    environment: dog['environment'] ?? null,
    planStatus: dog['planStatus'],
    wellnessScore: dog['wellnessScore'] ?? null,
    createdAt: dog['createdAt'],
    healthRecords: healthRecords.map((r) => ({
      SK: r['SK'],
      type: r['type'],
      title: r['title'],
      value: r['value'] ?? null,
      createdAt: r['createdAt'],
    })),
  });
};
