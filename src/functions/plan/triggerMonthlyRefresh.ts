import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';

const sfn = new SFNClient({});

function getPrevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export const handler = async (_event: unknown): Promise<{ processed: number; succeeded: number; failed: number }> => {
  const table = process.env['TABLE_NAME']!;
  const stateMachineArn = process.env['STATE_MACHINE_ARN']!;
  const prevMonth = getPrevMonth();

  // Paginate through all plan records from last month
  const dogIds: string[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `PLAN#${prevMonth}` },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of result.Items ?? []) {
      const gsi1sk = item['GSI1SK'] as string;
      const dogId = gsi1sk.replace('DOG#', '');
      dogIds.push(dogId);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`triggerMonthlyRefresh: found ${dogIds.length} dogs with plans in ${prevMonth}`);

  // Process in batches of 25
  const BATCH_SIZE = 25;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < dogIds.length; i += BATCH_SIZE) {
    const batch = dogIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((dogId) =>
        sfn.send(
          new StartExecutionCommand({
            stateMachineArn,
            name: `refresh-${prevMonth}-${dogId}`,
            input: JSON.stringify({ dogId, month: prevMonth }),
          }),
        ),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') succeeded++;
      else {
        failed++;
        console.error('Failed to start execution:', r.reason);
      }
    }
  }

  const summary = { processed: dogIds.length, succeeded, failed };
  console.log('triggerMonthlyRefresh summary:', JSON.stringify(summary));
  return summary;
};
