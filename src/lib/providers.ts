import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamodb';

export interface ProviderRow {
  vetId: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  pushToken?: string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

/**
 * Lists active veterinarians via GSI3 (PROVIDER_TYPE#veterinarian). Used to fan
 * out Ask-a-Vet broadcast alerts. A missing isActive flag counts as active.
 */
export async function listActiveVeterinarians(table: string): Promise<ProviderRow[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PROVIDER_TYPE#veterinarian' },
    }),
  );

  return ((res.Items ?? []) as ProviderRow[]).filter((v) => v['isActive'] !== false);
}
