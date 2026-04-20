import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  const result = await docClient.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `VET#${vetId}`, ':prefix': 'NOTIF#' },
    ScanIndexForward: false,
  }));

  const notifications = (result.Items ?? []).map((n) => ({
    notifId: n['notifId'] as string,
    type: n['type'] as string,
    payload: n['payload'] ?? null,
    readAt: n['readAt'] ?? null,
    createdAt: n['createdAt'] as string,
  }));

  return success({ notifications });
};
