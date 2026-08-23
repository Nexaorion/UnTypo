export const IPC_CHANNELS = {
  ping: 'app:ping',
} as const;

export interface PingResponse {
  appName: string;
  platform: string;
  version: string;
}

export interface UntypoApi {
  ping: () => Promise<PingResponse>;
}
