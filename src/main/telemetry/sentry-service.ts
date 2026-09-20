import * as Sentry from '@sentry/electron/main';

const SENTRY_DSN =
  'https://336004e027cbf498738361a3735ed439@o4509333304573952.ingest.us.sentry.io/4511989186035712';

const beforeSend = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  delete event.breadcrumbs;
  delete event.extra;
  if (event.request) delete event.request.data;
  return event;
};

export const initSentryTelemetryBeforeReady = (): void => {
  Sentry.init({
    beforeSend,
    dsn: SENTRY_DSN,
    integrations: (defaults) =>
      defaults.filter(
        ({ name }) =>
          name !== 'OnUncaughtException' &&
          name !== 'OnUnhandledRejection' &&
          name !== 'SentryMinidump',
      ),
  });
  const client = Sentry.getClient();
  if (client) client.getOptions().enabled = false;
};

export const applyTelemetryEnabled = (enabled: boolean): void => {
  const client = Sentry.getClient();
  if (client) client.getOptions().enabled = enabled;
};

export const captureTelemetryException = (error: unknown, tags?: Record<string, string>): void => {
  Sentry.captureException(error, tags ? { tags } : undefined);
};

export const flushSentryTelemetry = async (timeoutMs = 2_000): Promise<void> => {
  await Sentry.flush(timeoutMs);
};
