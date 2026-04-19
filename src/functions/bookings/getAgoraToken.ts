import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { generateRtcToken } from '../../lib/agora';
import { success, error } from '../../lib/response';
import { getUserId } from '../../lib/auth';

const JOIN_WINDOW_MS = 30 * 60 * 1000;
const TOKEN_EXPIRY_SECONDS = 3600;

// Deterministic uint32 hash of a string (djb2)
const hashUserId = (userId: string): number => {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const bookingId = event.pathParameters?.['bookingId'];

  if (!bookingId) return error('INVALID_REQUEST', 'bookingId is required', 400);

  const result = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `BOOKING#${bookingId}`, SK: 'BOOKING' } }),
  );

  const booking = result.Item;
  if (!booking) return error('NOT_FOUND', 'Booking not found', 404);

  const isOwner = booking['ownerId'] === userId;
  const isVet = booking['vetId'] === userId;
  if (!isOwner && !isVet) return error('FORBIDDEN', 'Access denied', 403);

  if (booking['status'] !== 'upcoming') {
    return error('INVALID_STATUS', 'Token only available for upcoming bookings', 400);
  }

  const scheduledAt = new Date(booking['scheduledAt'] as string);
  const now = Date.now();
  const diffMs = scheduledAt.getTime() - now;

  if (diffMs > JOIN_WINDOW_MS) {
    return error('TOO_EARLY', 'Too early to join — available within 30 minutes of scheduled time', 403);
  }

  const uid = hashUserId(userId);
  const channelId = booking['agoraChannelId'] as string;
  const { token, appId } = await generateRtcToken(channelId, uid, TOKEN_EXPIRY_SECONDS);
  const expiresAt = new Date(now + TOKEN_EXPIRY_SECONDS * 1000).toISOString();

  return success({ token, channelId, uid, appId, expiresAt });
};
