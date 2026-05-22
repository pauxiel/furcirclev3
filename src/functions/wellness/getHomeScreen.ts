import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../lib/dynamodb';
import { success } from '../../lib/response';
import { getUserId } from '../../lib/auth';
import type { CategoryScores } from '../../lib/wellness';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event);
  const table = process.env['TABLE_NAME']!;
  const month = new Date().toISOString().slice(0, 7);
  const requestedDogId = event.queryStringParameters?.['dogId'];

  // Batch 1: owner data + dog list in parallel
  const [batchResult, dogsResult] = await Promise.all([
    docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: {
            Keys: [
              { PK: `OWNER#${userId}`, SK: 'PROFILE' },
              { PK: `OWNER#${userId}`, SK: 'SUBSCRIPTION' },
            ],
          },
        },
      }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `OWNER#${userId}`,
          ':prefix': 'DOG#',
        },
      }),
    ),
  ]);

  const batchItems = batchResult.Responses?.[table] ?? [];
  const owner = batchItems.find((i) => (i['SK'] as string) === 'PROFILE') ?? null;
  const subscription = batchItems.find((i) => (i['SK'] as string) === 'SUBSCRIPTION') ?? null;

  const dogs = dogsResult.Items ?? [];

  // Resolve target dog
  const dog = requestedDogId
    ? (dogs.find((d) => (d['dogId'] as string) === requestedDogId) ?? null)
    : (dogs[0] ?? null);

  if (!dog) {
    const ctaBanners = buildCtaBanners(subscription);
    return success({ owner, dog: null, plan: null, actionSteps: [], pillSummaries: null, ctaBanners });
  }

  const dogId = dog['dogId'] as string;

  // Batch 2: plan + activities in parallel
  const [planResult, activitiesResult] = await Promise.all([
    docClient.send(
      new GetCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: `PLAN#${month}` } }),
    ),
    docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `DOG#${dogId}`,
          ':prefix': `ACTIVITY#${month}`,
        },
      }),
    ),
  ]);

  const plan = planResult.Item ?? null;
  const activities = activitiesResult.Items ?? [];
  const ctaBanners = buildCtaBanners(subscription);

  if (!plan) {
    const planField = dog['planStatus'] === 'generating' ? { planStatus: 'generating' } : null;
    return success({
      owner,
      dog: sanitizeDog(dog),
      plan: planField,
      actionSteps: [],
      pillSummaries: null,
      ctaBanners,
    });
  }

  const completedTexts = new Set(
    activities.filter((a) => a['type'] === 'completed_task').map((a) => a['taskText'] as string),
  );

  const whatToDo = plan['whatToDo'] as Array<{ stepId?: string; title?: string; text: string; videoTopic?: string | null; steps?: unknown[] }> ?? [];
  const toSlug = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z-]/g, '');
  const actionSteps = whatToDo.map((item, idx) => ({
    stepId: item.stepId ?? (item.title ? toSlug(item.title) : null) ?? (item.videoTopic ? toSlug(item.videoTopic) : null) ?? `step-${idx}`,
    title: item.title ?? item.videoTopic ?? `Step ${idx + 1}`,
    text: item.text,
    completed: completedTexts.has(item.text),
  }));

  const pillSummaries = {
    whatToDo: `${whatToDo.length} action${whatToDo.length !== 1 ? 's' : ''}`,
    whatNotToDo: `${((plan['whatNotToDo'] as unknown[]) ?? []).length} to avoid`,
    watchFor: `${((plan['watchFor'] as unknown[]) ?? []).length} to watch`,
    earlyWarningSigns: `${((plan['earlyWarningSigns'] as unknown[]) ?? []).length} warning signs`,
  };

  return success({
    owner,
    dog: sanitizeDog(dog),
    plan: {
      month: plan['month'],
      monthLabel: (() => {
        const age = plan['ageMonthsAtPlan'] as number;
        const name = dog['name'] as string;
        return age < 12 ? `Month ${age} with ${name}` : `Year ${Math.floor(age / 12)} with ${name}`;
      })(),
      ageMonthsAtPlan: plan['ageMonthsAtPlan'],
      wellnessScore: dog['wellnessScore'],
      categoryScores: dog['categoryScores'] as CategoryScores,
      completedCount: completedTexts.size,
      totalTasks: whatToDo.length,
      allComplete: completedTexts.size === whatToDo.length && whatToDo.length > 0,
    },
    actionSteps,
    pillSummaries,
    ctaBanners,
  });
};

function sanitizeDog(dog: Record<string, unknown>) {
  return {
    dogId: dog['dogId'],
    name: dog['name'],
    breed: dog['breed'],
    ageMonths: dog['ageMonths'],
    planStatus: dog['planStatus'],
    wellnessScore: dog['wellnessScore'],
    categoryScores: dog['categoryScores'],
    photoUrl: dog['photoUrl'] ?? null,
  };
}

function buildCtaBanners(subscription: Record<string, unknown> | null): Array<{ type: string; message: string }> {
  const banners: Array<{ type: string; message: string }> = [];
  const plan = subscription?.['plan'] as string | undefined;
  if (!plan || plan === 'welcome' || plan === 'protector') {
    banners.push({ type: 'upgrade', message: 'Upgrade to unlock full breed-specific plans and vet insights.' });
  }
  return banners;
}
