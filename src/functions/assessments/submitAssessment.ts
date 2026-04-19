import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from '../../lib/dynamodb';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const sns = new SNSClient({});

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const topicArn = process.env['SNS_TOPIC_ARN']!;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { vetId, dogId, description, mediaUrls } = body;

  if (!vetId || typeof vetId !== 'string') return error('VALIDATION_ERROR', 'vetId required', 400);
  if (!dogId || typeof dogId !== 'string') return error('VALIDATION_ERROR', 'dogId required', 400);
  if (!description || typeof description !== 'string' || description.length < 50) {
    return error('VALIDATION_ERROR', 'description must be at least 50 characters', 400);
  }

  const urls = (mediaUrls as string[] | undefined) ?? [];
  if (urls.length > 3) {
    return error('VALIDATION_ERROR', 'mediaUrls cannot exceed 3 items', 400);
  }
  for (const url of urls) {
    if (!url.includes('/assessments/')) {
      return error('VALIDATION_ERROR', 'mediaUrls must be S3 URLs under the assessments/ path', 400);
    }
  }

  // Check for existing pending/approved assessment for this owner+vet
  const existing = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `OWNER#${userId}`,
        ':sk': `ASSESSMENT#${vetId}`,
      },
      Limit: 1,
    }),
  );

  const existingItem = existing.Items?.[0];
  if (existingItem && (existingItem['status'] === 'pending' || existingItem['status'] === 'approved')) {
    return error('ASSESSMENT_EXISTS', 'An active assessment already exists for this provider', 409);
  }

  const assessmentId = uuidv4();
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `ASSESSMENT#${assessmentId}`,
        SK: 'ASSESSMENT',
        GSI1PK: `OWNER#${userId}`,
        GSI1SK: `ASSESSMENT#${vetId}`,
        GSI2PK: `VET#${vetId}`,
        GSI2SK: `ASSESSMENT#pending#${now}`,
        assessmentId,
        ownerId: userId,
        vetId,
        dogId,
        providerType: 'behaviourist',
        description,
        mediaUrls: urls,
        status: 'pending',
        vetResponse: null,
        createdAt: now,
        reviewedAt: null,
      },
    }),
  );

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'assessment_submitted',
        Message: JSON.stringify({ vetId, assessmentId, ownerId: userId, dogId }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success({ assessmentId, vetId, dogId, status: 'pending', createdAt: now }, 201);
};
