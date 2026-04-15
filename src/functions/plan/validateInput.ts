import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';

interface ValidateInputEvent {
  dogId: string;
  [key: string]: unknown;
}

export const handler = async (event: ValidateInputEvent): Promise<Record<string, unknown>> => {
  const { dogId } = event;
  const table = process.env['TABLE_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) throw new Error('DOG_NOT_FOUND');

  return {
    dogId: dog['dogId'],
    ownerId: dog['ownerId'],
    name: dog['name'],
    breed: dog['breed'],
    ageMonths: dog['ageMonths'],
    spayedNeutered: dog['spayedNeutered'] ?? null,
    medicalConditions: dog['medicalConditions'] ?? null,
    environment: dog['environment'] ?? null,
  };
};
