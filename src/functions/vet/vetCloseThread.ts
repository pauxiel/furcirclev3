import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
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
  const threadId = event.pathParameters?.['threadId'];

  if (!threadId) return error('INVALID_REQUEST', 'threadId is required', 400);

  const { Item: metadata } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  if (!metadata) return error('NOT_FOUND', 'Thread not found', 404);
  if (metadata['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);
  if (metadata['status'] === 'closed') return error('ALREADY_CLOSED', 'Thread is already closed', 400);

  const closedAt = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :closed, closedAt = :closedAt, updatedAt = :closedAt, GSI2SK = :gsi2sk',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':closed': 'closed',
        ':closedAt': closedAt,
        ':gsi2sk': `THREAD#closed#${metadata['createdAt']}`,
      },
    }),
  );

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'thread_closed',
        Message: JSON.stringify({ threadId, ownerId: metadata['ownerId'], vetId }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({ threadId, status: 'closed', closedAt });
};
