import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const SPAYED_NEUTERED_VALUES = ['yes', 'no', 'not_yet'] as const;
type SpayedNeutered = (typeof SPAYED_NEUTERED_VALUES)[number];

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { name, breed, ageMonths, spayedNeutered, environment, medicalConditions } = body;

  if (!name || typeof name !== 'string') {
    return error('VALIDATION_ERROR', 'name is required', 400);
  }
  if (!breed || typeof breed !== 'string') {
    return error('VALIDATION_ERROR', 'breed is required', 400);
  }
  if (ageMonths === undefined || ageMonths === null || typeof ageMonths !== 'number') {
    return error('VALIDATION_ERROR', 'ageMonths is required and must be a number', 400);
  }
  if ((ageMonths as number) < 0 || (ageMonths as number) > 240) {
    return error('VALIDATION_ERROR', 'ageMonths must be between 0 and 240', 400);
  }
  if (!spayedNeutered || !SPAYED_NEUTERED_VALUES.includes(spayedNeutered as SpayedNeutered)) {
    return error('VALIDATION_ERROR', `spayedNeutered must be one of: ${SPAYED_NEUTERED_VALUES.join(', ')}`, 400);
  }

  const ownerId = getUserId(event);
  const dogId = uuidv4();
  const table = process.env['TABLE_NAME']!;
  const now = new Date().toISOString();

  const dob = new Date();
  dob.setMonth(dob.getMonth() - (ageMonths as number));
  const dateOfBirth = dob.toISOString().slice(0, 10);

  const puts: Promise<unknown>[] = [
    docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          PK: `DOG#${dogId}`,
          SK: 'PROFILE',
          GSI1PK: `OWNER#${ownerId}`,
          GSI1SK: `DOG#${dogId}`,
          dogId,
          ownerId,
          name,
          breed,
          ageMonths,
          dateOfBirth,
          spayedNeutered,
          environment: environment ?? null,
          planStatus: 'generating',
          wellnessScore: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ),
  ];

  if (spayedNeutered === 'yes' || spayedNeutered === 'no') {
    const recordId = uuidv4();
    puts.push(
      docClient.send(
        new PutCommand({
          TableName: table,
          Item: {
            PK: `DOG#${dogId}`,
            SK: `HEALTH#spayed_neutered#${recordId}`,
            dogId,
            type: 'spayed_neutered',
            title: 'Spayed / Neutered',
            value: spayedNeutered,
            createdAt: now,
          },
        }),
      ),
    );
  }

  if (medicalConditions && typeof medicalConditions === 'string' && (medicalConditions as string).trim()) {
    const recordId = uuidv4();
    puts.push(
      docClient.send(
        new PutCommand({
          TableName: table,
          Item: {
            PK: `DOG#${dogId}`,
            SK: `HEALTH#medical_condition#${recordId}`,
            dogId,
            type: 'medical_condition',
            title: 'Medical Conditions',
            value: medicalConditions,
            createdAt: now,
          },
        }),
      ),
    );
  }

  await Promise.all(puts);

  return success(
    {
      dogId,
      ownerId,
      name,
      breed,
      ageMonths,
      dateOfBirth,
      spayedNeutered,
      environment: environment ?? null,
      planStatus: 'generating',
      createdAt: now,
    },
    201,
  );
};
