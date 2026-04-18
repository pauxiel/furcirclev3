import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

  const { vetId, dogId, assessmentId, duration, scheduledAt } = body;

  if (!vetId || typeof vetId !== 'string') return error('VALIDATION_ERROR', 'vetId required', 400);
  if (!dogId || typeof dogId !== 'string') return error('VALIDATION_ERROR', 'dogId required', 400);
  if (duration !== 15 && duration !== 30) return error('VALIDATION_ERROR', 'duration must be 15 or 30', 400);
  if (!scheduledAt || typeof scheduledAt !== 'string') return error('VALIDATION_ERROR', 'scheduledAt required', 400);
  if (new Date(scheduledAt).getTime() <= Date.now()) {
    return error('VALIDATION_ERROR', 'scheduledAt must be a future datetime', 400);
  }

  const subResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' } }),
  );
  const sub = subResult.Item;

  if (!sub || sub['plan'] !== 'proactive') {
    return error('FORBIDDEN', 'Proactive plan required to book consultations', 403);
  }
  if ((sub['creditBalance'] as number) < (duration as number)) {
    return error('INSUFFICIENT_CREDITS', 'Insufficient credits for this booking', 402);
  }

  const vetResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: 'PROFILE' } }),
  );
  const vet = vetResult.Item;

  // For behaviourist: require approved assessment
  if (vet && vet['providerType'] === 'behaviourist') {
    if (!assessmentId || typeof assessmentId !== 'string') {
      return error('ASSESSMENT_REQUIRED', 'Approved assessment required for behaviourist booking', 400);
    }
    const assessResult = await docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `ASSESSMENT#${assessmentId}`, SK: 'ASSESSMENT' } }),
    );
    const assessment = assessResult.Item;
    if (!assessment || assessment['status'] !== 'approved') {
      return error('ASSESSMENT_REQUIRED', 'Approved assessment required for behaviourist booking', 400);
    }
  }

  // Check slot availability
  const slotDate = (scheduledAt as string).substring(0, 10);
  const slotTime = (scheduledAt as string).substring(11, 16);
  const availResult = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `VET#${vetId}`, SK: `AVAIL#${slotDate}` } }),
  );
  const availRecord = availResult.Item;
  const slots = (availRecord?.['slots'] as Array<{ time: string; available: boolean }>) ?? [];
  const slot = slots.find((s) => s.time === slotTime);
  if (!slot || !slot.available) {
    return error('SLOT_UNAVAILABLE', 'Requested time slot is not available', 409);
  }

  const bookingId = uuidv4();
  const now = new Date().toISOString();
  const agoraChannelId = `furcircle-booking-${bookingId}`;
  const cost = duration as number;

  // Atomic credit deduction
  const updatedSub = await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
      UpdateExpression: 'SET creditBalance = creditBalance - :cost, updatedAt = :now',
      ConditionExpression: 'creditBalance >= :cost',
      ExpressionAttributeValues: { ':cost': cost, ':now': now },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const newBalance = (updatedSub.Attributes?.['creditBalance'] as number) ?? 0;

  // Mark slot unavailable
  const updatedSlots = slots.map((s) =>
    s.time === slotTime ? { ...s, available: false } : s,
  );
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `VET#${vetId}`, SK: `AVAIL#${slotDate}` },
      UpdateExpression: 'SET slots = :slots',
      ExpressionAttributeValues: { ':slots': updatedSlots },
    }),
  );

  // Write booking record
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `BOOKING#${bookingId}`,
        SK: 'BOOKING',
        GSI1PK: `OWNER#${userId}`,
        GSI1SK: `BOOKING#upcoming#${scheduledAt}`,
        GSI2PK: `VET#${vetId}`,
        GSI2SK: `BOOKING#upcoming#${scheduledAt}`,
        bookingId,
        ownerId: userId,
        vetId,
        dogId,
        assessmentId: assessmentId ?? null,
        duration: cost,
        scheduledAt,
        status: 'upcoming',
        creditsDeducted: cost,
        agoraChannelId,
        postCallSummary: null,
        createdAt: now,
      },
    }),
  );

  try {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: 'booking_confirmed',
        Message: JSON.stringify({ bookingId, vetId, ownerId: userId, dogId, scheduledAt }),
      }),
    );
  } catch (err) {
    console.error('SNS publish failed (non-fatal):', err);
  }

  return success(
    {
      bookingId,
      vetId,
      vet: vet
        ? { firstName: vet['firstName'], lastName: vet['lastName'], providerType: vet['providerType'], photoUrl: vet['photoUrl'] ?? null }
        : null,
      dogId,
      duration: cost,
      scheduledAt,
      status: 'upcoming',
      creditsDeducted: cost,
      creditBalance: newBalance,
      agoraChannelId,
      createdAt: now,
    },
    201,
  );
};
