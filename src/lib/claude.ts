import Anthropic from '@anthropic-ai/sdk';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

let client: Anthropic | null = null;

const getClient = async (): Promise<Anthropic> => {
  if (client) return client;

  const stage = process.env['STAGE'] ?? 'dev';
  const { Parameter } = await ssm.send(
    new GetParameterCommand({
      Name: `/furcircle/${stage}/anthropic/apiKey`,
      WithDecryption: true,
    }),
  );

  client = new Anthropic({ apiKey: Parameter!.Value! });
  return client;
};

export interface DogProfile {
  dogId: string;
  breed: string;
  ageMonths: number;
  spayedNeutered?: string | null;
  medicalConditions?: string | null;
  environment?: string | null;
}

export interface PlanData {
  whatToExpect: string;
  whatToDo: Array<{ text: string; videoTopic?: string }>;
  whatNotToDo: Array<{ text: string }>;
  watchFor: Array<{ text: string }>;
  earlyWarningSigns: Array<{ text: string; action: string }>;
  comingUpNextMonth: string;
  milestones: Array<{ emoji: string; title: string; description: string }>;
  wellnessScore: number;
}

export const generatePlan = async (dog: DogProfile): Promise<PlanData> => {
  const anthropic = await getClient();
  const month = new Date().toISOString().slice(0, 7); // yyyy-mm

  const userPrompt = `Generate a monthly wellness plan for a dog with the following profile:
- Breed: ${dog.breed}
- Age: ${dog.ageMonths} months
- Spayed/Neutered: ${dog.spayedNeutered ?? 'unknown'}
- Medical conditions: ${dog.medicalConditions ?? 'None known'}
- Environment: ${dog.environment ?? 'Not specified'}

Today's month: ${month}

Return a JSON object with these exact keys:
{
  "whatToExpect": "string — 2-3 sentence narrative overview of this developmental stage",
  "whatToDo": [{ "text": "string", "videoTopic": "string — optional topic for training video" }],
  "whatNotToDo": [{ "text": "string" }],
  "watchFor": [{ "text": "string" }],
  "earlyWarningSigns": [{ "text": "string", "action": "string" }],
  "comingUpNextMonth": "string — 1-2 sentences previewing next month",
  "milestones": [
    { "emoji": "string", "title": "string", "description": "string" }
  ],
  "wellnessScore": number between 0 and 100
}

Rules:
- whatToDo: 4–6 items
- whatNotToDo: 2–4 items
- watchFor: 2–4 items
- earlyWarningSigns: 2–4 items
- milestones: exactly 3 items
- wellnessScore: baseline for a healthy dog of this breed and age (not penalised for user's specific dog)
- All advice must be appropriate for this specific breed and age in months`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    system:
      "You are FurCircle's dog wellness engine. You generate personalised monthly wellness plans for dog owners based on their dog's breed, age, and health context.\n\nAlways respond with valid JSON matching the exact schema provided. No markdown, no explanation. Only the JSON object.",
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = (message.content[0] as { text: string }).text.trim();
  // Strip markdown code fences if present
  const json = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  return JSON.parse(json) as PlanData;
};
