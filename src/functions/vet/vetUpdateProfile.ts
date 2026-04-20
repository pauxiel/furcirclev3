import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const ALLOWED_FIELDS = ['bio', 'specialisation', 'isActive', 'pushToken'] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const updates = ALLOWED_FIELDS.filter((f) => f in body);
  if (updates.length === 0) {
    return error('VALIDATION_ERROR', 'At least one of bio, specialisation, isActive required', 400);
  }

  const now = new Date().toISOString();
  const setExpressions = updates.map((f) => `#${f} = :${f}`);
  setExpressions.push('updatedAt = :now');

  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = { ':now': now };
  for (const f of updates) {
    expressionAttributeNames[`#${f}`] = f;
    expressionAttributeValues[`:${f}`] = body[f as AllowedField];
  }

  try {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `VET#${vetId}`, SK: 'PROFILE' },
        UpdateExpression: `SET ${setExpressions.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    const p = result.Attributes!;
    return success({
      vetId: p['vetId'],
      firstName: p['firstName'],
      lastName: p['lastName'],
      email: p['email'],
      providerType: p['providerType'],
      specialisation: p['specialisation'] ?? null,
      bio: p['bio'] ?? null,
      photoUrl: p['photoUrl'] ?? null,
      rating: p['rating'] ?? null,
      reviewCount: p['reviewCount'] ?? 0,
      isActive: p['isActive'] ?? true,
      createdAt: p['createdAt'],
    });
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') {
      return error('VET_NOT_FOUND', 'Vet profile not found', 404);
    }
    throw err;
  }
};
