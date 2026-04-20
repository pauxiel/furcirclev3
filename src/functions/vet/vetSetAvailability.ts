import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { isValidTime, isFutureOrToday, findBookedSlotConflict, type Slot } from '../../lib/availabilityValidation';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const date = event.pathParameters?.['date'];

  if (!date) return error('VALIDATION_ERROR', 'date is required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const slots = (body['slots'] ?? []) as Slot[];

  if (!isFutureOrToday(date)) return error('PAST_DATE', 'Cannot set availability for past dates', 400);

  for (const slot of slots) {
    if (!isValidTime(slot.time)) {
      return error('INVALID_TIME', `Invalid time ${slot.time} — must be on 30-minute boundary`, 400);
    }
  }

  const existing = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: `AVAIL#${date}` } }),
  );

  if (existing.Item) {
    const existingSlots = (existing.Item['slots'] ?? []) as Slot[];
    const conflict = findBookedSlotConflict(slots, existingSlots);
    if (conflict) {
      return error('SLOT_BOOKED', `Slot ${conflict} already has a booking and cannot be modified`, 409);
    }
  }

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: { PK: `VET#${vetId}`, SK: `AVAIL#${date}`, vetId, date, slots },
    }),
  );

  return success({ date, slots });
};
