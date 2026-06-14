/**
 * End-to-end test for the Ask-a-Vet group-chat model against the deployed dev
 * stack. Proves the founder's requirement: one owner asks a question and
 * MULTIPLE vets can read and answer it (no exclusive claim), while a non-vet is
 * rejected from the vet endpoints.
 *
 * Requires: deployed dev stack + .env.test (USER_POOL_ID, USER_POOL_CLIENT_ID,
 * TABLE_NAME, API_URL, AWS_REGION) + AWS credentials.
 * Run: npm run test:e2e
 */
import axios from 'axios';
import { config } from 'dotenv';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { given_an_authenticated_user, teardown_user, TestUser } from '../fixtures/users';
import { given_a_veterinarian, teardown_vet, TestVet } from '../fixtures/vets';
import { requireIntegrationEnv } from '../fixtures/env';

config({ path: '.env.test' });

const subFromIdToken = (idToken: string): string =>
  JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')).sub as string;

describe('Ask-a-Vet group chat (e2e)', () => {
  let owner: TestUser | null = null;
  let vetA: TestVet | null = null;
  let vetB: TestVet | null = null;
  let ownerId = '';
  let dogId = '';
  let threadId = '';
  let api = '';
  let doc: DynamoDBDocumentClient;
  let table = '';

  const authHeader = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    requireIntegrationEnv();
    api = process.env['API_URL']!;
    table = process.env['TABLE_NAME']!;
    doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' }));

    owner = await given_an_authenticated_user();
    ownerId = subFromIdToken(owner.idToken);

    // Create a dog owned by the owner (direct write — avoids triggering async
    // plan generation, which is irrelevant to messaging).
    dogId = randomUUID();
    await doc.send(new PutCommand({
      TableName: table,
      Item: {
        PK: `DOG#${dogId}`,
        SK: 'PROFILE',
        GSI1PK: `OWNER#${ownerId}`,
        GSI1SK: `DOG#${dogId}`,
        dogId,
        ownerId,
        name: 'Buddy',
        breed: 'Golden Retriever',
        ageMonths: 3,
        createdAt: new Date().toISOString(),
      },
    }));

    [vetA, vetB] = await Promise.all([
      given_a_veterinarian({ firstName: 'Sarah', lastName: 'Mitchell' }),
      given_a_veterinarian({ firstName: 'Tom', lastName: 'Reed' }),
    ]);
  }, 60_000);

  afterAll(async () => {
    // Delete every item under the thread (METADATA + messages), then the dog.
    if (threadId && doc) {
      const res = await doc.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `THREAD#${threadId}` },
      }));
      for (const item of res.Items ?? []) {
        await doc.send(new DeleteCommand({ TableName: table, Key: { PK: item['PK'], SK: item['SK'] } }));
      }
    }
    if (dogId && doc) {
      await doc.send(new DeleteCommand({ TableName: table, Key: { PK: `DOG#${dogId}`, SK: 'PROFILE' } }));
    }
    await Promise.all([teardown_vet(vetA), teardown_vet(vetB), teardown_user(owner)]);
  }, 60_000);

  it('owner creates an open ask_a_vet thread (no vet assigned)', async () => {
    const res = await axios.post(
      `${api}/threads`,
      { dogId, type: 'ask_a_vet', initialMessage: 'My puppy keeps mouthing — is that normal?' },
      authHeader(owner!.idToken),
    );
    expect(res.status).toBe(201);
    expect(res.data.status).toBe('open');
    expect(res.data.vetId).toBeNull();
    threadId = res.data.threadId;
    expect(threadId).toBeTruthy();
  });

  it('rejects a non-vet (owner) from the vet message endpoint with 403', async () => {
    await expect(
      axios.post(`${api}/vet/threads/${threadId}/messages`, { body: 'I am not a vet' }, authHeader(owner!.idToken)),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });

  it('lets the first vet read and reply to the open question', async () => {
    const read = await axios.get(`${api}/vet/threads/${threadId}`, authHeader(vetA!.idToken));
    expect(read.status).toBe(200);

    const reply = await axios.post(
      `${api}/vet/threads/${threadId}/messages`,
      { body: 'Yes, mouthing is completely normal at 3 months.' },
      authHeader(vetA!.idToken),
    );
    expect(reply.status).toBe(201);
    expect(reply.data.senderType).toBe('vet');
  });

  it('lets a SECOND vet also read and reply (no claim, no 409)', async () => {
    const read = await axios.get(`${api}/vet/threads/${threadId}`, authHeader(vetB!.idToken));
    expect(read.status).toBe(200);

    const reply = await axios.post(
      `${api}/vet/threads/${threadId}/messages`,
      { body: 'Adding to that — try redirecting onto a chew toy.' },
      authHeader(vetB!.idToken),
    );
    expect(reply.status).toBe(201);
    expect(reply.data.senderType).toBe('vet');
  });

  it('owner sees replies from BOTH vets in the thread', async () => {
    const res = await axios.get(`${api}/threads/${threadId}`, authHeader(owner!.idToken));
    expect(res.status).toBe(200);

    const vetMessages = res.data.messages.filter((m: { senderType: string }) => m.senderType === 'vet');
    expect(vetMessages).toHaveLength(2);

    const senderIds = new Set(vetMessages.map((m: { senderId: string }) => m.senderId));
    expect(senderIds.has(vetA!.vetId)).toBe(true);
    expect(senderIds.has(vetB!.vetId)).toBe(true);

    // Both participating vets are resolved with their names.
    expect(res.data.vets).toHaveLength(2);
    const names = res.data.vets.map((v: { firstName: string }) => v.firstName).sort();
    expect(names).toEqual(['Sarah', 'Tom']);
  });
});
