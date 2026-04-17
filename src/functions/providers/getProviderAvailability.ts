import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';

const MAX_WINDOW_DAYS = 14;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const table = process.env['TABLE_NAME']!;
  const vetId = event.pathParameters?.['vetId'];
  const params = event.queryStringParameters ?? {};
  const startDate = params['startDate'];
  const endDate = params['endDate'];

  if (!vetId) {
    return error('INVALID_REQUEST', 'vetId is required', 400);
  }

  if (!startDate || !endDate) {
    return error('INVALID_REQUEST', 'startDate and endDate are required', 400);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return error('INVALID_REQUEST', 'startDate and endDate must be valid dates', 400);
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > MAX_WINDOW_DAYS) {
    return error('INVALID_REQUEST', `Date window cannot exceed ${MAX_WINDOW_DAYS} days`, 400);
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `VET#${vetId}`,
        ':start': `AVAIL#${startDate}`,
        ':end': `AVAIL#${endDate}`,
      },
    }),
  );

  const availMap = new Map<string, unknown[]>();
  for (const rec of result.Items ?? []) {
    availMap.set(rec['date'] as string, (rec['slots'] as unknown[]) ?? []);
  }

  const availability: { date: string; slots: unknown[] }[] = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().substring(0, 10);
    availability.push({ date: dateStr, slots: availMap.get(dateStr) ?? [] });
    current.setDate(current.getDate() + 1);
  }

  return success({ vetId, availability });
};
