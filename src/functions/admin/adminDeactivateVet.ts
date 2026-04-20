import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;
  const vetId = event.pathParameters?.['vetId'];
  if (!vetId) return error('INVALID_REQUEST', 'vetId is required', 400);

  const { Item: vet } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } }),
  );

  if (!vet) return error('NOT_FOUND', 'Vet not found', 404);

  await docClient.send(new UpdateCommand({
    TableName: table,
    Key: { PK: `VET#${vetId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET isActive = :false, updatedAt = :now',
    ExpressionAttributeValues: { ':false': false, ':now': new Date().toISOString() },
  }));

  return success({ vetId, isActive: false });
};
