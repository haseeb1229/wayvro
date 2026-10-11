import { EVIDENCE_KIND_VALUES, type DriverApplication, type EvidenceUploadStatus } from '@wayvro/contracts';
import type { RequirementChecklist } from '../api/driver-api';
import type { EvidenceKind, FailureReason, RejectionReason, UploadItem } from '../upload/upload-queue';
import { checklistFieldHints, type DocumentFieldHints } from './field-hints';

/**
 * Requirement checklist and submission readiness (P2.8; D01–D03 UI). Built from the server's checklist, the
 * application's document claims, the server's evidence list and the LOCAL upload queue (in-flight photos). The server
 * decides submission; `canSubmit` only avoids a request that would certainly be refused.
 */

type DocumentView = DriverApplication['documents'][number];
type RequirementItem = RequirementChecklist['items'][number];

export type EvidenceDisplay =
  | { readonly state: 'none' }
  | { readonly state: 'queued' | 'uploading' | 'processing'; readonly localId: string }
  | { readonly state: 'failed'; readonly localId: string; readonly failure: FailureReason; readonly canRetry: boolean }
  | { readonly state: 'accepted'; readonly uploadId: string }
  | { readonly state: 'rejected'; readonly uploadId: string | null; readonly rejection: RejectionReason };

export interface EvidenceSlotView {
  readonly kind: EvidenceKind;
  readonly display: EvidenceDisplay;
}

type ItemStatus = 'not-started' | 'details-saved' | 'in-progress' | 'ready' | 'action-needed' | 'unsupported';

export interface ChecklistItem {
  readonly documentType: string;
  readonly mandatory: boolean;
  readonly subject: RequirementItem['subject'];
  /** Route permits are claimed per district; the app has no district list yet (contract gap), so they are not offered. */
  readonly supported: boolean;
  readonly licenceClassesAllowed: readonly string[];
  /** Claim fields offered for this item, derived from the server's document facts. */
  readonly hints: DocumentFieldHints;
  readonly document: DocumentView | null;
  readonly evidence: readonly EvidenceSlotView[];
  readonly status: ItemStatus;
}

export interface ChecklistModel {
  readonly placeholder: boolean;
  readonly items: readonly ChecklistItem[];
  /** Items the server marks not applicable (e.g. an authorisation letter for a registered owner). */
  readonly notApplicable: readonly string[];
  readonly readyMandatory: number;
  readonly totalMandatory: number;
  readonly uploadsInFlight: boolean;
  readonly canSubmit: boolean;
}

const LIVE_DOCUMENT_STATUSES: ReadonlySet<DocumentView['status']> = new Set(['SUBMITTED', 'UNDER_REVIEW', 'VALID']);

export const isEvidenceKind = (kind: string): kind is EvidenceKind => (EVIDENCE_KIND_VALUES as readonly string[]).includes(kind);

/** The claim the evidence must belong to: the latest live claim of the type (re-claims supersede earlier ones). @internal exported for unit tests */
export function currentDocument(application: DriverApplication, documentType: string): DocumentView | null {
  const live = application.documents.filter((d) => d.documentType === documentType && LIVE_DOCUMENT_STATUSES.has(d.status));
  return live.at(-1) ?? null;
}

/**
 * What to show for one evidence kind of one claimed document: an in-flight local item wins; otherwise the server's
 * outcome (accepted beats processing beats the latest rejection). Expired/discarded server slots count as nothing.
 */
export function evidenceDisplay(
  documentId: string | null,
  kind: EvidenceKind,
  server: readonly EvidenceUploadStatus[],
  queue: readonly UploadItem[],
): EvidenceDisplay {
  if (documentId === null) return { state: 'none' };
  const local = queue.filter((i) => i.documentId === documentId && i.kind === kind).at(-1);
  if (local) {
    switch (local.state) {
      case 'queued':
      case 'slot':
        return { state: 'queued', localId: local.id };
      case 'uploading':
      case 'completing':
        return { state: 'uploading', localId: local.id };
      case 'processing':
        return { state: 'processing', localId: local.id };
      case 'failed':
        return { state: 'failed', localId: local.id, failure: local.failure ?? 'unknown', canRetry: !local.fileDeleted && local.failure !== 'file-missing' };
      case 'accepted':
      case 'rejected':
        break;
    }
  }
  const mine = server.filter((e) => e.documentId === documentId && e.kind === kind);
  const accepted = mine.find((e) => e.status === 'ACCEPTED');
  if (accepted) return { state: 'accepted', uploadId: accepted.uploadId };
  const processing = mine.find((e) => e.status === 'PROCESSING');
  if (processing) return { state: 'processing', localId: processing.uploadId };
  const rejected = mine.filter((e) => e.status === 'REJECTED').at(-1);
  if (rejected) return { state: 'rejected', uploadId: rejected.uploadId, rejection: rejected.rejectionReason ?? 'UNREADABLE' };
  if (local?.state === 'rejected') return { state: 'rejected', uploadId: local.uploadId, rejection: local.rejection ?? 'UNREADABLE' };
  return { state: 'none' };
}

function itemStatus(document: DocumentView | null, evidence: readonly EvidenceSlotView[], supported: boolean): ItemStatus {
  if (!supported) return 'unsupported';
  if (evidence.some((e) => e.display.state === 'failed' || e.display.state === 'rejected')) return 'action-needed';
  if (document === null) return 'not-started';
  if (evidence.length > 0 && evidence.every((e) => e.display.state === 'accepted')) return 'ready';
  if (evidence.some((e) => e.display.state !== 'none')) return 'in-progress';
  return evidence.length === 0 ? 'ready' : 'details-saved';
}

export function checklistModel(
  checklist: RequirementChecklist,
  application: DriverApplication,
  server: readonly EvidenceUploadStatus[],
  queue: readonly UploadItem[],
): ChecklistModel {
  const items: ChecklistItem[] = [];
  const notApplicable: string[] = [];
  for (const req of checklist.items) {
    if (!req.applicable) {
      notApplicable.push(req.documentType);
      continue;
    }
    const supported = !req.perDistrict;
    const document = currentDocument(application, req.documentType);
    const evidence = req.evidenceKinds.filter(isEvidenceKind).map((kind) => ({ kind, display: evidenceDisplay(document?.id ?? null, kind, server, queue) }));
    items.push({
      documentType: req.documentType,
      mandatory: req.mandatory,
      subject: req.subject,
      supported,
      licenceClassesAllowed: req.licenceClassesAllowed,
      hints: checklistFieldHints(req),
      document,
      evidence,
      status: itemStatus(document, evidence, supported),
    });
  }
  // Required first, then in the server's order.
  items.sort((a, b) => Number(b.mandatory) - Number(a.mandatory));
  const mandatory = items.filter((i) => i.mandatory);
  const readyMandatory = mandatory.filter((i) => i.status === 'ready').length;
  const uploadsInFlight = queue.some(
    (i) =>
      i.applicationId === application.id &&
      (i.state === 'queued' || i.state === 'slot' || i.state === 'uploading' || i.state === 'completing' || i.state === 'processing'),
  );
  return {
    placeholder: checklist.isPlaceholder,
    items,
    notApplicable,
    readyMandatory,
    totalMandatory: mandatory.length,
    uploadsInFlight,
    canSubmit: readyMandatory === mandatory.length && !uploadsInFlight,
  };
}

// ── submission refusals ──────────────────────────────────────────────────────────────────────────────────────────

export type MissingItem =
  | { readonly kind: 'document'; readonly documentType: string }
  | { readonly kind: 'evidence'; readonly evidenceKind: EvidenceKind }
  | { readonly kind: 'processing' }
  | { readonly kind: 'no-requirement-set' }
  | { readonly kind: 'unknown'; readonly code: string };

/** Maps the itemised 409 reason codes of a refused submission (or renewal submission) to readable items. */
export function missingItems(reasonCodes: readonly string[]): readonly MissingItem[] {
  return reasonCodes.map((code): MissingItem => {
    if (code === 'EVIDENCE_PROCESSING') return { kind: 'processing' };
    if (code === 'NO_ACTIVE_REQUIREMENT_SET') return { kind: 'no-requirement-set' };
    if (code.startsWith('MISSING_DOCUMENT_')) {
      const documentType = code.slice('MISSING_DOCUMENT_'.length);
      return { kind: 'document', documentType };
    }
    if (code.startsWith('MISSING_EVIDENCE_')) {
      const evidenceKind = code.slice('MISSING_EVIDENCE_'.length);
      if (isEvidenceKind(evidenceKind)) return { kind: 'evidence', evidenceKind };
    }
    return { kind: 'unknown', code };
  });
}
