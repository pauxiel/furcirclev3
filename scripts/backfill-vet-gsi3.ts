/**
 * Backfills GSI3 keys on provider (VET#) records so they appear in the
 * rating-sorted /providers listing. Needed for veterinarians, which were not
 * previously surfaced through listProviders and may lack GSI3PK/GSI3SK.
 *
 * GSI3PK = PROVIDER_TYPE#${providerType}
 * GSI3SK = RATING#${rating}#VET#${vetId}
 *
 * Idempotent: skips records that already have GSI3PK.
 *
 * Usage:
 *   npx ts-node scripts/backfill-vet-gsi3.ts --stage dev          # dry run
 *   npx ts-node scripts/backfill-vet-gsi3.ts --stage dev --apply  # write
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const stage = process.argv.includes('--stage')
  ? process.argv[process.argv.indexOf('--stage') + 1]
  : 'dev';
const apply = process.argv.includes('--apply');

const table = `furcircle-${stage}`;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

// Rating is embedded in GSI3SK to sort the listing; pad so string sort matches
// numeric order (e.g. 4.9 > 4.85 > 4.8). Default new providers to 0.0.
const ratingKey = (rating: unknown): string => {
  const n = typeof rating === 'number' ? rating : 0;
  return n.toFixed(2);
};

async function main(): Promise<void> {
  console.log(`Backfill GSI3 on ${table} (${apply ? 'APPLY' : 'dry run'})`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let startKey: Record<string, unknown> | undefined;

  do {
    const res = await doc.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'begins_with(PK, :p) AND SK = :sk',
        ExpressionAttributeValues: { ':p': 'VET#', ':sk': 'PROFILE' },
        ExclusiveStartKey: startKey,
      }),
    );

    for (const item of res.Items ?? []) {
      scanned += 1;
      const vetId = item['vetId'] as string | undefined;
      const providerType = item['providerType'] as string | undefined;

      if (item['GSI3PK']) {
        skipped += 1;
        continue;
      }
      if (!vetId || !providerType) {
        console.warn(`  skip ${item['PK']} — missing vetId or providerType`);
        skipped += 1;
        continue;
      }

      const gsi3pk = `PROVIDER_TYPE#${providerType}`;
      const gsi3sk = `RATING#${ratingKey(item['rating'])}#VET#${vetId}`;
      console.log(`  ${apply ? 'set' : 'would set'} ${item['PK']} -> ${gsi3pk} / ${gsi3sk}`);

      if (apply) {
        await doc.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: item['PK'], SK: item['SK'] },
            UpdateExpression: 'SET GSI3PK = :pk, GSI3SK = :sk',
            ExpressionAttributeValues: { ':pk': gsi3pk, ':sk': gsi3sk },
          }),
        );
      }
      updated += 1;
    }

    startKey = res.LastEvaluatedKey;
  } while (startKey);

  console.log(`Done. scanned=${scanned} ${apply ? 'updated' : 'to-update'}=${updated} skipped=${skipped}`);
  if (!apply && updated > 0) console.log('Re-run with --apply to write.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
