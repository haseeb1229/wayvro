import { z } from 'zod';
import { STORAGE_KEYS, type KeyValueStore } from '../../../core/session/key-value-store';
import { UploadItemSchema, type UploadItem } from './upload-queue';
import type { QueuePersistence } from './upload-runner';

/**
 * Upload-queue metadata in OS secure storage (Q01): ids, the local file name, size, MIME type and state — never image
 * bytes, upload URLs or claims. Unreadable or foreign-shaped data is dropped (fail closed); the runner's orphan sweep
 * then deletes any file no item references.
 */
const StoredQueueSchema = z.object({ v: z.literal(1), items: z.array(UploadItemSchema) });

export function secureQueuePersistence(store: KeyValueStore): QueuePersistence {
  return {
    load: async () => {
      const raw = await store.getItem(STORAGE_KEYS.evidenceQueue);
      if (raw === null) return [];
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return [];
      }
      const parsed = StoredQueueSchema.safeParse(json);
      return parsed.success ? parsed.data.items : [];
    },
    save: (items: readonly UploadItem[]) =>
      items.length === 0 ? store.deleteItem(STORAGE_KEYS.evidenceQueue) : store.setItem(STORAGE_KEYS.evidenceQueue, JSON.stringify({ v: 1, items })),
    clear: () => store.deleteItem(STORAGE_KEYS.evidenceQueue),
  };
}
