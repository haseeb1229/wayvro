# Native Urdu / Roman-Urdu review package (FA-09)

Development tools for the native-speaker review that Phase 3 needs before exit (P18, A06, K19;
`docs/phase3/PHASE3_EXTERNAL_FOUNDER_ACTIONS.md` FA-09 and §6). All Urdu (`ur`) and Roman-Urdu (`ur-Latn`) copy in the
app was drafted with AI help and is **PENDING_NATIVE_REVIEW**. AI-drafted or AI-corrected text never counts as
reviewed. Only a native reviewer's returned sheet, applied by a developer, can change that.

Nothing in these tools marks a string as reviewed. The output folder `apps/wayvro-mobile/i18n-review/` is git-ignored.

## 1. Export the package (developer or founder)

```sh
pnpm --filter @wayvro/wayvro-mobile i18n:export
```

This writes three files. Running it again on the same code gives byte-identical files and the same **export id**:

| File | What it holds |
|---|---|
| `i18n-review/wayvro-strings-review.csv` | One row per string (app and Driver/Partner): `export_id`, `catalogue`, `key`, `context` (which screen), `screens` (source files that show it), `flags` (SAFETY / LEGAL / PRICE / PERMISSION), `max_length` (English length + 40 %), `placeholders`, `en`, `ur`, `ur_latn`, current status, then the empty reviewer columns `review_status`, `ur_corrected`, `ur_latn_corrected`, `reviewer_note`. |
| `i18n-review/wayvro-search-aliases-review.csv` | The synthetic search spellings (Roman Urdu, English, Urdu script) for the synthetic Lahore landmarks. All are PROPOSED; none is used by search until staff approve it (maker-checker). |
| `i18n-review/wayvro-i18n-review.json` | The same package as JSON. **Keep it unchanged**: the import checks the returned sheet against it. |

The console prints counts by locale, flag and alias locale. Also prepare screenshots of each new screen in Urdu and
Roman Urdu with synthetic data only (the SP-08 matrix or a local build); never real user data.

## 2. What the founder sends the reviewer

Send both CSV files (and the screenshots). Ask the reviewer to open the CSV in Google Sheets or LibreOffice (both keep
the Urdu script; in Excel use *Data → From Text/CSV* with UTF-8) and to return it as **CSV**, with these instructions:

1. For every row fill `review_status` with **OK** (correct as it is), **CHANGE** (write the corrected text in
   `ur_corrected` and/or `ur_latn_corrected`) or **QUESTION** (write the question in `reviewer_note`). Leave a row empty
   only if you did not review it.
2. Check that the meaning matches the English and that nothing is unsafe or ambiguous. Rows flagged SAFETY, LEGAL,
   PRICE or PERMISSION need the most care.
3. Keep every `{placeholder}` exactly as it is (for example `{place}`, `{amount}`); the app fills them in.
4. Use natural, polite, gender-neutral wording where possible, and the same words for the same things (fare, pickup,
   drop-off, ride, Driver/Partner).
5. Keep text within `max_length` where you can (longer text wraps; very long button text is hard to read).
6. Number and currency format: amounts are shown as "Rs 1,250" with Western digits in every language. Tell us if
   lakh grouping (Rs 1,25,000), Urdu digits or "روپے" would read better (these are recorded as pending decisions).
7. Search aliases: mark spellings people really type as OK, wrong ones as CHANGE (with the right spelling in
   `alias_corrected`) or QUESTION, and add common missing spellings in `reviewer_note`.
8. Do not change the `export_id`, `catalogue`, `key`, `locale` or `alias` columns.
9. Return the files together with your **name or initials**, the **date** of the review and this sentence, written by you:
   **"I reviewed this personally and did not rely only on machine translation."**

## 3. Import the returned sheet (developer)

Put the returned files anywhere outside Git (for example `apps/wayvro-mobile/i18n-review/returned/`), then run (relative
paths are resolved from `apps/wayvro-mobile/`):

```sh
pnpm --filter @wayvro/wayvro-mobile i18n:import-review -- \
  --reviewer "<name or initials from the sheet>" \
  --date <YYYY-MM-DD from the sheet> \
  --declaration "I reviewed this personally and did not rely only on machine translation." \
  --strings i18n-review/returned/wayvro-strings-review.csv \
  --aliases i18n-review/returned/wayvro-search-aliases-review.csv
```

The import **refuses** (exit code 1, nothing written) when the reviewer name, the date or the exact declaration is
missing; when the JSON export was modified; when a row has a key or alias that is not in that export, comes from a
different export, appears twice or has another status than OK / CHANGE / QUESTION; when a CHANGE has no corrected text;
or when corrected text changes the `{placeholders}`. Rows whose catalogue text changed after the export are listed as
**stale** and are not used (export again and send only those rows).

It writes `i18n-review/returned/intake-<record id>.json` with the decisions, the stale rows, the alias decisions and a
`proposedLedger` fragment. It does **not** mark anything reviewed (`markedReviewed: false`).

## 4. Apply the review (developer, in a normal reviewed change)

1. Apply every CHANGE to the catalogues (`src/core/i18n/strings.ts`, `src/features/driver/i18n/driver-strings.ts`)
   exactly as written by the reviewer. Answer every QUESTION with the founder before using that row.
2. Copy `proposedLedger.record` into `REVIEW_LEDGER.records` and the entries of `proposedLedger.reviewed` you applied
   into `REVIEW_LEDGER.reviewed` in `src/core/i18n/review-status.ts`. Leave QUESTION rows out.
3. Run `pnpm --filter @wayvro/wayvro-mobile test`. The ledger test fails if a string is marked REVIEWED without a valid
   reviewer record, or if the reviewed text does not match the catalogue (for example a CHANGE that was not applied).
4. Alias decisions go to staff: a staff member proposes the corrected aliases and a **different** staff member approves
   them in the ops console (the database enforces approver ≠ creator). The synthetic aliases are local/test data only.
5. Update the native-review status in the Phase-3 closure report (P18 / A06 / K19). Until the review is applied these
   stay PARTIAL / external-gated, and the app keeps showing the "translation pending native-speaker review" note.
