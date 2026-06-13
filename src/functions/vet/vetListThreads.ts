import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const qs = event.queryStringParameters ?? {};
  const statusFilter = qs['status'] as string | undefined;
  const typeFilter = qs['type'] as string | undefined;
  const limit = Math.min(parseInt(qs['limit'] ?? '20', 10), 50);

  const skPrefix = statusFilter ? `THREAD#${statusFilter}#` : 'THREAD#';

  // The vet's own private 1:1 threads live under VET#${vetId}. Shared Ask-a-Vet
  // group questions live in the QUEUE#ask_a_vet partition (status open until
  // closed) so every vet can see and reply to them. Include the queue unless the
  // caller is filtering by a non-open status (e.g. closed).
  const includeQueue = !statusFilter || statusFilter === 'open';

  const queries: Promise<{ Items?: Record<string, unknown>[] }>[] = [
    docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `VET#${vetId}`, ':prefix': skPrefix },
        ScanIndexForward: false,
        Limit: limit,
      }),
    ),
  ];
  if (includeQueue) {
    queries.push(
      docClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
          ExpressionAttributeValues: { ':pk': 'QUEUE#ask_a_vet', ':prefix': 'THREAD#open#' },
          ScanIndexForward: false,
          Limit: limit,
        }),
      ),
    );
  }

  const queryResults = await Promise.all(queries);
  const merged = queryResults.flatMap((r) => r.Items ?? []);

  // Dedupe by threadId, apply type filter, sort newest-first, cap at limit.
  const seen = new Set<string>();
  let threads = merged.filter((t) => {
    const id = t['threadId'] as string;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (typeFilter) threads = threads.filter((t) => t['type'] === typeFilter);
  threads.sort((a, b) => String(b['createdAt']).localeCompare(String(a['createdAt'])));
  threads = threads.slice(0, limit);

  if (threads.length === 0) return success({ threads: [] });

  const ownerKeys = [...new Set(threads.map((t) => t['ownerId'] as string))].flatMap((id) => [
    { PK: `OWNER#${id}`, SK: 'PROFILE' },
    { PK: `OWNER#${id}`, SK: 'SUBSCRIPTION' },
  ]);
  const dogKeys = [...new Set(threads.map((t) => t['dogId'] as string))].map((id) => ({
    PK: `DOG#${id}`, SK: 'PROFILE',
  }));

  const [batchResult, ...msgResults] = await Promise.all([
    docClient.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: [...ownerKeys, ...dogKeys] } } })),
    ...threads.map((t) =>
      docClient.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `THREAD#${t['threadId'] as string}`, ':prefix': 'MSG#' },
        ScanIndexForward: false,
        Limit: 1,
      })),
    ),
  ]);

  const profiles = (batchResult as { Responses?: Record<string, Record<string, unknown>[]> }).Responses?.[table] ?? [];
  const ownerMap = Object.fromEntries(
    profiles.filter((p) => (p['PK'] as string).startsWith('OWNER#') && p['SK'] === 'PROFILE').map((p) => [p['userId'], p]),
  );
  const subMap = Object.fromEntries(
    profiles.filter((p) => (p['PK'] as string).startsWith('OWNER#') && p['SK'] === 'SUBSCRIPTION').map((p) => [
      (p['PK'] as string).replace('OWNER#', ''), p,
    ]),
  );
  const dogMap = Object.fromEntries(
    profiles.filter((p) => (p['PK'] as string).startsWith('DOG#')).map((p) => [p['dogId'], p]),
  );

  const assembled = threads.map((t, idx) => {
    const owner = ownerMap[t['ownerId'] as string];
    const sub = subMap[t['ownerId'] as string];
    const dog = dogMap[t['dogId'] as string];
    const msgs = (msgResults[idx] as { Items?: Record<string, unknown>[] }).Items ?? [];
    const lastMsg = msgs[0] ?? null;
    const plan = sub?.['plan'] as string | undefined;
    const isPriority = plan === 'protector' || plan === 'proactive';

    return {
      threadId: t['threadId'],
      type: t['type'],
      status: t['status'],
      owner: owner ? { userId: owner['userId'], firstName: owner['firstName'], lastName: owner['lastName'] } : null,
      dog: dog ? { dogId: dog['dogId'], name: dog['name'], breed: dog['breed'], ageMonths: dog['ageMonths'] } : null,
      lastMessage: lastMsg ? { body: lastMsg['body'], senderType: lastMsg['senderType'], createdAt: lastMsg['createdAt'] } : null,
      unreadCount: msgs.filter((m) => m['senderType'] === 'owner' && m['readAt'] == null).length,
      isPriority,
      createdAt: t['createdAt'],
    };
  });

  return success({ threads: assembled });
};
