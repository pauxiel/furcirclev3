import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const ALLOWED_FIELDS = ['name', 'breed', 'ageMonths', 'environment', 'photoUrl'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

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

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  // Build update expression from allowed fields only
  const updates: { field: AllowedField; value: unknown }[] = [];
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      updates.push({ field, value: body[field] });
    }
  }

  if (updates.length === 0) {
    return error('VALIDATION_ERROR', 'No valid fields to update', 400);
  }

  const now = new Date().toISOString();
  const ExpressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const ExpressionAttributeValues: Record<string, unknown> = { ':updatedAt': now };
  const setParts: string[] = ['#updatedAt = :updatedAt'];

  updates.forEach(({ field, value }, i) => {
    const nameKey = `#f${i}`;
    const valueKey = `:v${i}`;
    ExpressionAttributeNames[nameKey] = field;
    ExpressionAttributeValues[valueKey] = value;
    setParts.push(`${nameKey} = ${valueKey}`);
  });

  const { Attributes: updated } = await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return success(updated ?? dog);
};
