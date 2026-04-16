import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { vetId, dogId, type, initialMessage } = body;

  if (!vetId || typeof vetId !== 'string') return error('VALIDATION_ERROR', 'vetId required', 400);
  if (!dogId || typeof dogId !== 'string') return error('VALIDATION_ERROR', 'dogId required', 400);
  if (type !== 'ask_a_vet') return error('VALIDATION_ERROR', 'type must be ask_a_vet', 400);
  if (!initialMessage || typeof initialMessage !== 'string') return error('VALIDATION_ERROR', 'initialMessage required', 400);
  if (initialMessage.length < 1 || initialMessage.length > 2000) return error('VALIDATION_ERROR', 'initialMessage must be 1–2000 chars', 400);

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN']!;

  // Parallel: fetch dog, subscription, vet
  const [dogResult, subResult, vetResult] = await Promise.all([
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } })),
    docClient.send(new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } })),
  ]);

  const dog = dogResult.Item;
  const subscription = subResult.Item;
  const vet = vetResult.Item;

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);
  if (!vet || vet['isActive'] === false) return error('VET_NOT_FOUND', 'Vet not found or inactive', 404);

  // Subscription gate for welcome plan
  const plan = subscription?.['plan'] as string | undefined;
  if (!plan || plan === 'welcome') {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { Count = 0 } = await docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `OWNER#${userId}`,
          ':prefix': `THREAD#ask_a_vet#${currentMonth}`,
        },
        Select: 'COUNT',
      }),
    );
    if (Count >= 1) return error('MONTHLY_LIMIT_REACHED', 'Welcome plan allows 1 thread per month', 403);
  }

  const threadId = uuidv4();
  const messageId = uuidv4();
  const now = new Date().toISOString();
  const epochMs = Date.now();

  await Promise.all([
    docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `THREAD#${threadId}`,
          SK: 'METADATA',
          GSI1PK: `OWNER#${userId}`,
          GSI1SK: `THREAD#ask_a_vet#${now}`,
          GSI2PK: `VET#${vetId}`,
          GSI2SK: `THREAD#open#${now}`,
          threadId,
          ownerId: userId,
          vetId,
          dogId,
          type: 'ask_a_vet',
          status: 'open',
          createdAt: now,
          closedAt: null,
        },
      }),
    ),
    docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `THREAD#${threadId}`,
          SK: `MSG#${epochMs}#${messageId}`,
          messageId,
          threadId,
          senderId: userId,
          senderType: 'owner',
          body: initialMessage,
          readAt: null,
          createdAt: now,
        },
      }),
    ),
  ]);

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'message_received',
        Message: JSON.stringify({
          vetId,
          threadId,
          ownerName: dog['name'] ?? '',
          dogName: dog['name'] as string,
          pushToken: vet['pushToken'] ?? null,
          body: (initialMessage as string).slice(0, 100),
        }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success(
    {
      threadId,
      vetId,
      dogId,
      type: 'ask_a_vet',
      status: 'open',
      messages: [
        {
          messageId,
          senderId: userId,
          senderType: 'owner',
          body: initialMessage,
          readAt: null,
          createdAt: now,
        },
      ],
      createdAt: now,
    },
    201,
  );
};
