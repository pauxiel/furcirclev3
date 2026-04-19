import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const { startDate, endDate } = event.queryStringParameters ?? {};

  if (!startDate || !endDate) {
    return error('VALIDATION_ERROR', 'startDate and endDate are required', 400);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (diffDays > 30) return error('DATE_RANGE_TOO_LARGE', 'Date range cannot exceed 30 days', 400);

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

  const recordMap = Object.fromEntries(
    (result.Items ?? []).map((item) => [
      (item['SK'] as string).replace('AVAIL#', ''),
      item['slots'] ?? [],
    ]),
  );

  const availability: { date: string; slots: unknown[] }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().substring(0, 10);
    availability.push({ date: dateStr, slots: recordMap[dateStr] ?? [] });
    cursor.setDate(cursor.getDate() + 1);
  }

  return success({ vetId, availability });
};
