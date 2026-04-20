import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { isAdmin } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  if (!isAdmin(event)) return error('FORBIDDEN', 'Admin access required', 403);

  const table = process.env['TABLE_NAME']!;
  const qs = event.queryStringParameters ?? {};
  const status = qs['status'];

  const filterParts: string[] = ['SK = :sk'];
  const exprValues: Record<string, unknown> = { ':sk': 'BOOKING' };

  if (status) {
    filterParts.push('#status = :status');
    exprValues[':status'] = status;
  }

  const result = await docClient.send(new ScanCommand({
    TableName: table,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeValues: exprValues,
    ...(status ? { ExpressionAttributeNames: { '#status': 'status' } } : {}),
  }));

  const bookings = (result.Items ?? []).map((b) => ({
    bookingId: b['bookingId'],
    vetId: b['vetId'],
    ownerId: b['ownerId'],
    dogId: b['dogId'],
    status: b['status'],
    scheduledAt: b['scheduledAt'],
    duration: b['duration'],
    creditsCharged: b['creditsCharged'],
    createdAt: b['createdAt'],
  }));

  return success({ bookings, total: bookings.length });
};
