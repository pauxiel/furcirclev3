import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const notifId = event.pathParameters?.['notifId'];

  if (!notifId) return error('INVALID_REQUEST', 'notifId is required', 400);

  const { Item: notif } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: `NOTIF#${notifId}` } }),
  );

  if (!notif) return error('NOT_FOUND', 'Notification not found', 404);
  if (notif['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);

  const readAt = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: table,
    Key: { PK: `VET#${vetId}`, SK: `NOTIF#${notifId}` },
    UpdateExpression: 'SET readAt = :readAt',
    ExpressionAttributeValues: { ':readAt': readAt },
  }));

  return success({ notifId, readAt });
};
