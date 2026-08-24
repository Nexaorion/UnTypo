import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../i18n/context.js';
import { useToast } from '../ui/toast.js';
import { describeError } from './client.js';

/** Serialises one mutation at a time and surfaces failures as a toast. */
export const useAction = () => {
  const { t } = useI18n();
  const notify = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (
      key: string,
      task: () => Promise<void>,
      options: { successMessage?: string } = {},
    ): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setPendingKey(key);
      try {
        await task();
        if (options.successMessage) notify(options.successMessage);
        return true;
      } catch (error) {
        notify(t('error.unknown'), {
          description: describeError(error),
          type: 'error',
        });
        return false;
      } finally {
        running.current = false;
        setPendingKey(null);
      }
    },
    [notify, t],
  );

  return { isPending: (key: string) => pendingKey === key, pendingKey, run };
};
