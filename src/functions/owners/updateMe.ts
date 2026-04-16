import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const ALLOWED_FIELDS = ['firstName', 'lastName', 'pushToken'] as const;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const updates: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in body) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return error('VALIDATION_ERROR', 'No valid fields to update', 400);
  }

  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };

  for (const [key, val] of Object.entries(updates)) {
    sets.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  }
  sets.push('#updatedAt = :now');
  names['#updatedAt'] = 'updatedAt';

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `OWNER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    const item = result.Attributes ?? {};
    return success({
      userId: item['userId'],
      firstName: item['firstName'],
      lastName: item['lastName'],
      email: item['email'],
      pushToken: item['pushToken'] ?? null,
      updatedAt: item['updatedAt'],
    });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return error('OWNER_NOT_FOUND', 'Owner not found', 404);
    }
    throw err;
  }
};
