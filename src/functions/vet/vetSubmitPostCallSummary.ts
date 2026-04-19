import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN']!;
  const bookingId = event.pathParameters?.['bookingId'];

  if (!bookingId) return error('INVALID_REQUEST', 'bookingId is required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { summary, actionPlan } = body;

  if (!summary || typeof summary !== 'string' || summary.length < 100) {
    return error('SUMMARY_TOO_SHORT', 'summary must be at least 100 characters', 400);
  }
  if (actionPlan !== undefined && Array.isArray(actionPlan) && actionPlan.length > 10) {
    return error('TOO_MANY_ACTION_ITEMS', 'actionPlan cannot exceed 10 items', 400);
  }

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' } }),
  );

  const booking = result.Item;
  if (!booking) return error('NOT_FOUND', 'Booking not found', 404);
  if (booking['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);
  if (booking['status'] === 'cancelled') {
    return error('INVALID_STATUS', 'Cannot submit summary for cancelled booking', 400);
  }

  const submittedAt = new Date().toISOString();
  const followUpThreadId = uuidv4();
  const dogId = booking['dogId'] as string;
  const ownerId = booking['ownerId'] as string;

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' },
      UpdateExpression: 'SET #status = :completed, postCallSummary = :summary, updatedAt = :now, GSI1SK = :gsi1sk, GSI2SK = :gsi2sk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':summary': summary,
        ':now': submittedAt,
        ':gsi1sk': `BOOKING#completed#${booking['scheduledAt']}`,
        ':gsi2sk': `BOOKING#completed#${booking['scheduledAt']}`,
      },
    }),
  );

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `DOG#${dogId}`,
        SK: `HEALTH#consultation#${bookingId}`,
        dogId,
        bookingId,
        vetId,
        summary,
        actionPlan: actionPlan ?? [],
        createdAt: submittedAt,
      },
    }),
  );

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `THREAD#${followUpThreadId}`,
        SK: 'METADATA',
        GSI2PK: `VET#${vetId}`,
        GSI2SK: `THREAD#open#${submittedAt}`,
        threadId: followUpThreadId,
        type: 'post_booking',
        status: 'open',
        ownerId,
        vetId,
        dogId,
        bookingId,
        expiresAt: new Date(new Date(submittedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: submittedAt,
      },
    }),
  );

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'post_call_summary_ready',
        Message: JSON.stringify({ bookingId, ownerId, vetId, dogId, followUpThreadId }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({ bookingId, status: 'completed', summary, actionPlan: actionPlan ?? [], followUpThreadId, submittedAt });
};
