import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { recordId, fileKey, type, title } = body;

  if (!recordId || typeof recordId !== 'string') {
    return error('VALIDATION_ERROR', 'recordId is required', 400);
  }
  if (!fileKey || typeof fileKey !== 'string') {
    return error('VALIDATION_ERROR', 'fileKey is required', 400);
  }
  if (!type || typeof type !== 'string') {
    return error('VALIDATION_ERROR', 'type is required', 400);
  }

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const now = new Date().toISOString();
  const item = {
    PK: `DOG#${dogId}`,
    SK: `HEALTH#${type}#${recordId}`,
    dogId,
    recordId,
    type,
    title: title && typeof title === 'string' ? title : type,
    fileKey,
    createdAt: now,
  };

  await docClient.send(new PutCommand({ TableName: table, Item: item }));

  return success(item, 201);
};
