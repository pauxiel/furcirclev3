import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { getPresignedPutUrl } from '../../lib/s3';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const dogId = event.pathParameters?.['dogId'];
  if (!dogId) return error('VALIDATION_ERROR', 'dogId required', 400);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { contentType } = body;
  if (!contentType || typeof contentType !== 'string') {
    return error('VALIDATION_ERROR', 'contentType is required', 400);
  }

  const ext = CONTENT_TYPE_EXT[contentType];
  if (!ext) {
    return error('VALIDATION_ERROR', `Unsupported contentType. Allowed: ${Object.keys(CONTENT_TYPE_EXT).join(', ')}`, 400);
  }

  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const bucket = process.env['BUCKET_NAME']!;

  const { Item: dog } = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }),
  );

  if (!dog) return error('DOG_NOT_FOUND', 'Dog not found', 404);
  if (dog['ownerId'] !== userId) return error('FORBIDDEN', 'Access denied', 403);

  const key = `dogs/${dogId}/profile.${ext}`;
  const uploadUrl = await getPresignedPutUrl(bucket, key, contentType, 300);

  return success({ uploadUrl, photoUrl: key });
};
