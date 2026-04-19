import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN']!;
  const bookingId = event.pathParameters?.['bookingId'];

  if (!bookingId) return error('INVALID_REQUEST', 'bookingId is required', 400);

  const bookingResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' } }),
  );

  const booking = bookingResult.Item;
  if (!booking) return error('NOT_FOUND', 'Booking not found', 404);
  if (booking['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);
  if (booking['status'] !== 'upcoming') return error('INVALID_STATUS', 'Only upcoming bookings can be cancelled', 400);

  const now = new Date();
  const scheduledAt = new Date(booking['scheduledAt'] as string);
  const isRefundEligible = scheduledAt.getTime() - now.getTime() > REFUND_WINDOW_MS;
  const cost = booking['creditsDeducted'] as number;

  // Update booking status
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' },
      UpdateExpression: 'SET #status = :cancelled, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':cancelled': 'cancelled', ':now': now.toISOString() },
    }),
  );

  let newBalance: number | undefined;

  if (isRefundEligible) {
    const refundResult = await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
        UpdateExpression: 'SET creditBalance = creditBalance + :cost, updatedAt = :now',
        ExpressionAttributeValues: { ':cost': cost, ':now': now.toISOString() },
        ReturnValues: 'ALL_NEW',
      }),
    );
    newBalance = refundResult.Attributes?.['creditBalance'] as number;
  }

  // Restore vet availability slot
  const slotDate = (booking['scheduledAt'] as string).substring(0, 10);
  const slotTime = (booking['scheduledAt'] as string).substring(11, 16);
  const availResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${booking['vetId'] as string}`, SK: `AVAIL#${slotDate}` } }),
  );
  if (availResult.Item) {
    const slots = (availResult.Item['slots'] as Array<{ time: string; available: boolean }>) ?? [];
    const updatedSlots = slots.map((s) => (s.time === slotTime ? { ...s, available: true } : s));
    await docClient.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `VET#${booking['vetId'] as string}`, SK: `AVAIL#${slotDate}` },
        UpdateExpression: 'SET slots = :slots',
        ExpressionAttributeValues: { ':slots': updatedSlots },
      }),
    );
  }

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'booking_cancelled',
        Message: JSON.stringify({ bookingId, vetId: booking['vetId'], ownerId: userId, scheduledAt: booking['scheduledAt'] }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({
    bookingId,
    status: 'cancelled',
    creditsRefunded: isRefundEligible ? cost : 0,
    creditBalance: newBalance ?? null,
  });
};
