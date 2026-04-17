import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

let cachedAppId: string | null = null;
let cachedAppCertificate: string | null = null;

const loadCredentials = async (): Promise<{ appId: string; appCertificate: string }> => {
  if (cachedAppId && cachedAppCertificate) {
    return { appId: cachedAppId, appCertificate: cachedAppCertificate };
  }

  const stage = process.env['STAGE'] ?? 'dev';
  const [appIdResult, appCertResult] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: `/furcircle/${stage}/agora/appId`, WithDecryption: false })),
    ssm.send(new GetParameterCommand({ Name: `/furcircle/${stage}/agora/appCertificate`, WithDecryption: true })),
  ]);

  cachedAppId = appIdResult.Parameter!.Value!;
  cachedAppCertificate = appCertResult.Parameter!.Value!;
  return { appId: cachedAppId, appCertificate: cachedAppCertificate };
};

export const generateRtcToken = async (
  channelName: string,
  uid: number,
  expirySeconds: number,
): Promise<{ token: string; appId: string }> => {
  const { appId, appCertificate } = await loadCredentials();
  const expireTime = Math.floor(Date.now() / 1000) + expirySeconds;
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expireTime,
    expireTime,
  );
  return { token, appId };
};
