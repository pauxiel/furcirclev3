import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});
const VALID_DECISIONS = ['approved', 'rejected'] as const;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN']!;
  const assessmentId = event.pathParameters?.['assessmentId'];

  if (!assessmentId) return error('INVALID_REQUEST', 'assessmentId is required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { decision, response } = body;

  if (!decision || !VALID_DECISIONS.includes(decision as typeof VALID_DECISIONS[number])) {
    return error('VALIDATION_ERROR', 'decision must be approved or rejected', 400);
  }
  if (!response || typeof response !== 'string' || response.length < 50) {
    return error('RESPONSE_TOO_SHORT', 'response must be at least 50 characters', 400);
  }

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `ASSESSMENT#${assessmentId}`, SK: 'ASSESSMENT' } }),
  );

  const assessment = result.Item;
  if (!assessment) return error('NOT_FOUND', 'Assessment not found', 404);
  if (assessment['vetId'] !== vetId) return error('FORBIDDEN', 'Access denied', 403);
  if (assessment['status'] !== 'pending') return error('ALREADY_RESPONDED', 'Assessment already responded to', 400);

  const reviewedAt = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `ASSESSMENT#${assessmentId}`, SK: 'ASSESSMENT' },
      UpdateExpression:
        'SET #status = :status, vetResponse = :response, reviewedAt = :reviewedAt, GSI2SK = :gsi2sk, updatedAt = :reviewedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': decision,
        ':response': response,
        ':reviewedAt': reviewedAt,
        ':gsi2sk': `ASSESSMENT#${decision}#${assessment['createdAt']}`,
      },
    }),
  );

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'assessment_responded',
        Message: JSON.stringify({
          assessmentId,
          ownerId: assessment['ownerId'],
          vetId,
          decision,
        }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({ assessmentId, status: decision as string, response, reviewedAt });
};
