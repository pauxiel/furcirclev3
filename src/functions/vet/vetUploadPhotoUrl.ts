import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { getPresignedPutUrl } from '../../lib/s3';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const vetId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const bucket = process.env['BUCKET_NAME']!;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return error('VALIDATION_ERROR', 'Invalid JSON body', 400);
  }

  const { contentType } = body;
  if (!contentType || typeof contentType !== 'string' || !ALLOWED_TYPES[contentType]) {
    return error('INVALID_CONTENT_TYPE', 'contentType must be image/jpeg or image/png', 400);
  }

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } }),
  );
  if (!result.Item) return error('VET_NOT_FOUND', 'Vet profile not found', 404);

  const ext = ALLOWED_TYPES[contentType];
  const key = `vets/${vetId}/profile.${ext}`;
  const uploadUrl = await getPresignedPutUrl(bucket, key, contentType, 300);
  const photoUrl = `https://${bucket}.s3.amazonaws.com/${key}`;

  return success({ uploadUrl, photoUrl, expiresIn: 300 });
};
