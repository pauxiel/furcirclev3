import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import { isValidTime, isFutureOrToday, type Slot } from '../../lib/availabilityValidation';

interface DateEntry {
  date: string;
  slots: Slot[];
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const dates = body['dates'] as DateEntry[] | undefined;
  if (!dates || !Array.isArray(dates)) {
    return error('VALIDATION_ERROR', 'dates array is required', 400);
  }
  if (dates.length > 30) return error('TOO_MANY_DATES', 'Maximum 30 dates per request', 400);

  for (const entry of dates) {
    if (!isFutureOrToday(entry.date)) {
      return error('PAST_DATE', `Cannot set availability for past date: ${entry.date}`, 400);
    }
    for (const slot of entry.slots ?? []) {
      if (!isValidTime(slot.time)) {
        return error('INVALID_TIME', `Invalid time ${slot.time} in date ${entry.date}`, 400);
      }
    }
  }

  const results = await Promise.allSettled(
    dates.map((entry) =>
      docClient.send(
        new PutCommand({
          TableName: table,
          Item: { PK: `VET#${vetId}`, SK: `AVAIL#${entry.date}`, vetId, date: entry.date, slots: entry.slots ?? [] },
        }),
      ),
    ),
  );

  const updated = results.filter((r) => r.status === 'fulfilled').length;
  const skipped = results.filter((r) => r.status === 'rejected').length;

  return success({ updated, skipped });
};
