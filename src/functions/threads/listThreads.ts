import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { encodeCursor, decodeCursor } from '../../lib/threads';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const params = event.queryStringParameters ?? {};
  const typeFilter = params['type'] as string | undefined;
  const statusFilter = params['status'] as string | undefined;
  const limit = Math.min(parseInt(params['limit'] ?? '20', 10), 50);
  const nextToken = params['nextToken'];

  const gsiPrefix = typeFilter ? `THREAD#${typeFilter}#` : 'THREAD#';

  const threadsResult = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `OWNER#${userId}`,
        ':prefix': gsiPrefix,
      },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: nextToken ? decodeCursor(nextToken) : undefined,
    }),
  );

  let threads = threadsResult.Items ?? [];

  // Post-query status filter
  if (statusFilter) {
    threads = threads.filter((t) => t['status'] === statusFilter);
  }

  if (threads.length === 0) {
    return success({ threads: [], nextToken: null });
  }

  // Single BatchGetItem for all vet + dog profiles
  const batchKeys = threads.flatMap((t) => [
    { PK: `VET#${t['vetId'] as string}`, SK: 'PROFILE' },
    { PK: `DOG#${t['dogId'] as string}`, SK: 'PROFILE' },
  ]);

  const allResults = await Promise.all([
    docClient.send(
      new BatchGetCommand({ RequestItems: { [table]: { Keys: batchKeys } } }),
    ),
    ...threads.map((t) =>
      docClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `THREAD#${t['threadId'] as string}`,
            ':prefix': 'MSG#',
          },
          ScanIndexForward: false,
        }),
      ),
    ),
  ]);

  const batchResult = allResults[0] as { Responses?: Record<string, Record<string, unknown>[]> };
  const messageResults = allResults.slice(1) as { Items?: Record<string, unknown>[] }[];

  const batchItems = batchResult.Responses?.[table] ?? [];

  const getProfile = (pk: string) => batchItems.find((i) => i['PK'] === pk) ?? null;

  const assembled = threads.map((thread, idx) => {
    const vet = getProfile(`VET#${thread['vetId'] as string}`);
    const dog = getProfile(`DOG#${thread['dogId'] as string}`);
    const allMessages = messageResults[idx].Items ?? [];
    const lastMsg = allMessages[0] ?? null;
    const unreadCount = allMessages.filter(
      (m) => m['senderType'] === 'vet' && m['readAt'] == null,
    ).length;

    return {
      threadId: thread['threadId'],
      type: thread['type'],
      status: thread['status'],
      vet: vet
        ? { vetId: vet['vetId'], firstName: vet['firstName'], lastName: vet['lastName'], providerType: vet['providerType'], photoUrl: vet['photoUrl'] ?? null }
        : null,
      dog: dog
        ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'] }
        : null,
      lastMessage: lastMsg
        ? { body: lastMsg['body'], senderType: lastMsg['senderType'], createdAt: lastMsg['createdAt'] }
        : null,
      unreadCount,
      createdAt: thread['createdAt'],
    };
  });

  return success({
    threads: assembled,
    nextToken: threadsResult.LastEvaluatedKey ? encodeCursor(threadsResult.LastEvaluatedKey as Record<string, unknown>) : null,
  });
};
