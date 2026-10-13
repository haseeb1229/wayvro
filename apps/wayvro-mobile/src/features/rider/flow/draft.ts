/**
 * The rider's trip draft (B01/B02): pickup and drop-off chosen in this session. MEMORY ONLY — lost on process death by
 * design (no persistent places or coordinates on the phone in Phase 3); only the quote-group id survives a restart.
 * A place enters the draft only after a rider choice: a search suggestion resolved by the server, or a precise current
 * location the rider confirmed. An approximate fix never becomes a place.
 */
export type DraftField = 'pickup' | 'dropoff';
type PlaceSource = 'search' | 'current-location';

export interface DraftPlace {
  /** Display line from the server; null = no address known here (shown as "Pinned location", never invented). */
  readonly primary: string | null;
  readonly secondary: string | null;
  /** 5 decimals (≈1 m), as sent to the quote endpoint. */
  readonly point: { readonly lat: number; readonly lng: number };
  /** Sealed server reference (label source only; never used for pricing). */
  readonly placeRef: string | null;
  readonly source: PlaceSource;
  /** Server information-only check against the active zone set; null when unknown. */
  readonly inServiceArea: boolean | null;
}

export interface RiderDraft {
  readonly pickup: DraftPlace | null;
  readonly dropoff: DraftPlace | null;
}

export const EMPTY_DRAFT: RiderDraft = { pickup: null, dropoff: null };

export type DraftAction =
  | { readonly type: 'SET'; readonly field: DraftField; readonly place: DraftPlace }
  | { readonly type: 'CLEAR'; readonly field: DraftField }
  /** Location revoked / downgraded: places that came from the device location are discarded silently. */
  | { readonly type: 'DROP_DEVICE_PLACES' };

export function draftReducer(draft: RiderDraft, action: DraftAction): RiderDraft {
  switch (action.type) {
    case 'SET':
      return { ...draft, [action.field]: action.place };
    case 'CLEAR':
      return { ...draft, [action.field]: null };
    case 'DROP_DEVICE_PLACES':
      return {
        pickup: draft.pickup?.source === 'current-location' ? null : draft.pickup,
        dropoff: draft.dropoff?.source === 'current-location' ? null : draft.dropoff,
      };
  }
}

/** Both ends chosen ⇒ a price check may be requested (the server validates everything again). */
export function quoteInput(draft: RiderDraft): { readonly pickup: DraftPlace; readonly dropoff: DraftPlace } | null {
  return draft.pickup !== null && draft.dropoff !== null ? { pickup: draft.pickup, dropoff: draft.dropoff } : null;
}

/** The quote request point: coordinates plus the placeRef only when the place came from search. */
export function quotePoint(place: DraftPlace): { readonly lat: number; readonly lng: number; readonly placeRef?: string } {
  return place.placeRef === null ? { lat: place.point.lat, lng: place.point.lng } : { lat: place.point.lat, lng: place.point.lng, placeRef: place.placeRef };
}

/** Session recents: memory only, newest first, max 10, de-duplicated by placeRef or display line. */
export const MAX_RECENTS = 10;

export function addRecent(recents: readonly DraftPlace[], place: DraftPlace): readonly DraftPlace[] {
  if (place.source !== 'search') return recents;
  const same = (p: DraftPlace): boolean =>
    (place.placeRef !== null && p.placeRef === place.placeRef) || (p.primary === place.primary && p.secondary === place.secondary);
  return [place, ...recents.filter((p) => !same(p))].slice(0, MAX_RECENTS);
}
