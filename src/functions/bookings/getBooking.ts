import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const bookingId = event.pathParameters?.['bookingId'];

  if (!bookingId) return error('INVALID_REQUEST', 'bookingId is required', 400);

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' } }),
  );

  const booking = result.Item;
  if (!booking) return error('NOT_FOUND', 'Booking not found', 404);
  if (booking['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  return success({
    bookingId: booking['bookingId'],
    vetId: booking['vetId'],
    dogId: booking['dogId'],
    assessmentId: booking['assessmentId'] ?? null,
    duration: booking['duration'],
    scheduledAt: booking['scheduledAt'],
    status: booking['status'],
    creditsDeducted: booking['creditsDeducted'],
    agoraChannelId: booking['agoraChannelId'],
    postCallSummary: booking['postCallSummary'] ?? null,
    createdAt: booking['createdAt'],
  });
};
