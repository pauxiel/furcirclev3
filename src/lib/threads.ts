export type ThreadStatus = 'open' | 'closed';
export type ThreadType = 'ask_a_vet' | 'post_booking';
export type SenderType = 'owner' | 'vet';

export const encodeCursor = (lastEvaluatedKey: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');

export const decodeCursor = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Record<string, unknown>;

export const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};
