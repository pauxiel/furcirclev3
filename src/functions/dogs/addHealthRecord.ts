import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { v4 as uuidv4 } from 'uuid';

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

  const { fileKey, type, title, vaccineName, nextDueDate } = body;

  if (!type || typeof type !== 'string') {
    return error('VALIDATION_ERROR', 'type is required', 400);
  }
  const hasFile = fileKey && typeof fileKey === 'string';
  const hasManual = nextDueDate && typeof nextDueDate === 'string';
  if (!hasFile && !hasManual) {
    return error('VALIDATION_ERROR', 'fileKey or nextDueDate is required', 400);
  }

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const recordId = uuidv4();
  const now = new Date().toISOString();
  const item: Record<string, unknown> = {
    PK: `DOG#${dogId}`,
    SK: `HEALTH#${type}#${recordId}`,
    dogId,
    recordId,
    type,
    title: title && typeof title === 'string' ? title : (vaccineName && typeof vaccineName === 'string' ? vaccineName : type),
    createdAt: now,
  };

  if (hasFile) item['fileKey'] = fileKey;
  if (hasManual) item['nextDueDate'] = nextDueDate;
  if (vaccineName && typeof vaccineName === 'string') item['vaccineName'] = vaccineName;

  await docClient.send(new PutCommand({ TableName: table, Item: item }));

  return success(item, 201);
};
