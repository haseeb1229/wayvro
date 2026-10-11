import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { DRIVER_KEYS } from '../api/driver-queries';
import type { UploadItem } from '../upload/upload-queue';

/**
 * Re-reads the server's evidence list whenever a local upload of this application changes state or leaves the queue,
 * so the screens show the server's outcome (the local queue only tracks photos in flight).
 */
export function useQueueRefresh(applicationId: string, items: readonly UploadItem[]): void {
  const queryClient = useQueryClient();
  const signature = items
    .filter((i) => i.applicationId === applicationId)
    // Only server-visible changes matter: the upload was confirmed, decided or failed, or the item left the queue.
    .map((i) => (i.state === 'processing' || i.state === 'accepted' || i.state === 'rejected' || i.state === 'failed' ? `${i.id}:${i.state}` : i.id))
    .join('|');
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: DRIVER_KEYS.evidence(applicationId) });
  }, [queryClient, applicationId, signature]);
}
