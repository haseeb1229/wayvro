import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useServices } from '../../../core/services/ServicesProvider';
import { createDriverApi, type DriverApi } from '../api/driver-api';
import { runnerFor } from './runner-registry';
import type { UploadItem } from './upload-queue';
import type { UploadRunner } from './upload-runner';

/** The Driver/Partner API on the session transport. */
export function useDriverApi(): DriverApi {
  const { client } = useServices();
  return useMemo(() => createDriverApi(client.session), [client]);
}

export interface UploadQueueView {
  readonly runner: UploadRunner;
  readonly items: readonly UploadItem[];
  /** The persisted queue could not be restored from secure storage; `restart` tries again. */
  readonly restoreFailed: boolean;
  readonly restart: () => void;
}

/**
 * The session's upload runner and its live items (metadata only). The queue is restored the first time a
 * Driver/Partner screen mounts — never at app start.
 */
export function useUploadQueue(): UploadQueueView {
  const { store, clock } = useServices();
  const api = useDriverApi();
  const runner = useMemo(() => runnerFor(api, store, clock), [api, store, clock]);
  const items = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    runner.start().then(
      () => {
        if (active) setRestoreFailed(false);
      },
      () => {
        if (active) setRestoreFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runner, attempt]);
  const restart = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  return { runner, items, restoreFailed, restart };
}
