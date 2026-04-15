import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

export const getPresignedPutUrl = (
  bucket: string,
  key: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> => {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3, command, { expiresIn });
};
