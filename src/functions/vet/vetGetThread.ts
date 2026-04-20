import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const threadId = event.pathParameters?.['threadId'];

  if (!threadId) return error('INVALID_REQUEST', 'threadId is required', 400);

  const metaResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `THREAD#${threadId}`, SK: 'METADATA' } }),
  );

  const metadata = metaResult.Item;
  if (!metadata) return error('NOT_FOUND', 'Thread not found', 404);
  if (metadata['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);

  const [batchResult, msgResult] = await Promise.all([
    docClient.send(new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: [
            { PK: `OWNER#${metadata['ownerId']}`, SK: 'PROFILE' },
            { PK: `OWNER#${metadata['ownerId']}`, SK: 'SUBSCRIPTION' },
            { PK: `DOG#${metadata['dogId']}`, SK: 'PROFILE' },
          ],
        },
      },
    })),
    docClient.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `THREAD#${threadId}`, ':prefix': 'MSG#' },
      ScanIndexForward: true,
    })),
  ]);

  const profiles = batchResult.Responses?.[table] ?? [];
  const ownerProfile = profiles.find((p) => p['SK'] === 'PROFILE' && (p['PK'] as string).startsWith('OWNER#'));
  const ownerSub = profiles.find((p) => p['SK'] === 'SUBSCRIPTION');
  const dog = profiles.find((p) => (p['PK'] as string).startsWith('DOG#'));
  const messages = msgResult.Items ?? [];

  return success({
    threadId: metadata['threadId'],
    type: metadata['type'],
    status: metadata['status'],
    owner: ownerProfile
      ? {
          userId: ownerProfile['userId'],
          firstName: ownerProfile['firstName'],
          lastName: ownerProfile['lastName'],
          email: ownerProfile['email'],
          subscription: ownerSub ? { plan: ownerSub['plan'] } : null,
        }
      : null,
    dog: dog
      ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'], ageMonths: dog['ageMonths'], wellnessScore: dog['wellnessScore'] ?? null }
      : null,
    messages: messages.map((m) => ({
      messageId: m['messageId'],
      senderType: m['senderType'],
      body: m['body'],
      readAt: m['readAt'] ?? null,
      createdAt: m['createdAt'],
    })),
    createdAt: metadata['createdAt'],
  });
};
