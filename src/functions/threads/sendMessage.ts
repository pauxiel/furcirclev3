import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const threadId = event.pathParameters?.['threadId'];
  if (!threadId) return error('VALIDATION_ERROR', 'threadId required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const messageBody = body['body'];
  if (!messageBody || typeof messageBody !== 'string') return error('VALIDATION_ERROR', 'body required', 400);
  if (messageBody.length < 1 || messageBody.length > 2000) return error('VALIDATION_ERROR', 'body must be 1–2000 chars', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['NOTIFICATIONS_TOPIC_ARN']!;

  const { Item: metadata } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  if (!metadata) return error('THREAD_NOT_FOUND', 'Thread not found', 404);
  if (metadata['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);
  if (metadata['status'] === 'closed') return error('THREAD_CLOSED', 'Thread is closed', 403);

  const messageId = uuidv4();
  const now = new Date().toISOString();
  const sk = `MSG#${Date.now()}#${messageId}`;

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `THREAD#${threadId}`,
        SK: sk,
        messageId,
        senderId: userId,
        senderType: 'owner',
        body: messageBody,
        readAt: null,
        createdAt: now,
      },
    }),
  );

  try {
    const { Item: vet } = await docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `VET#${metadata['vetId'] as string}`, SK: 'PROFILE' } }),
    );
    if (vet?.['pushToken']) {
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify({
            type: 'NEW_MESSAGE',
            threadId,
            messageId,
            pushToken: vet['pushToken'],
          }),
        }),
      );
    }
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({ messageId, senderType: 'owner', body: messageBody, readAt: null, createdAt: now }, 201);
};
