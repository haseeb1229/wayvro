# FA-09 automated pre-review of the Urdu and Roman-Urdu copy

> **AUTOMATED PRE-REVIEW — NOT NATIVE REVIEW.** FA-09 stays **HUMAN_REVIEW_REQUIRED**. **0 of 933** strings are
> REVIEWED. Every `ur` and `ur-Latn` string is still `PENDING_NATIVE_REVIEW`. This run changed no review status and did
> not write `REVIEW_LEDGER`. A machine wrote the suggestion column, and nobody has reviewed it.

- **Date:** 2026-10-16 (laptop evidence sweep). **Branch:** `phase-3/maps-quotes-unified-ux` at HEAD `ef3cbd0`. These are
  uncommitted working-tree changes. The lead commits them.
- **Requirement IDs:** supports P18, A06 and K19 (FA-09). It does not satisfy them: they still need the native reviewer's
  signed sheet applied through `i18n:import-review` and the ledger.
- **Inputs:** the typed catalogues `apps/wayvro-mobile/src/core/i18n/strings.ts` (app) and
  `apps/wayvro-mobile/src/features/driver/i18n/driver-strings.ts` (Driver/Partner), the flag rules and `FORMAT_DECISIONS`
  in `src/core/i18n/review-status.ts`, and the bidi convention in `src/core/i18n/bidi.ts` / `interpolate()`.
- Synthetic test data only. No real user data. The tool makes no network call.

## 1. Regenerated review rows

`pnpm --filter @wayvro/wayvro-mobile i18n:export` (the existing export, unchanged in behaviour):

| Item | Value |
|---|---|
| Export id | `9f19b39b0f53abe4b3f155da53f8083bbaa3f1d61ad75d02b61c64b9b123d3c2` |
| Strings | **933** (app 471, driver 462) |
| `ur` / `ur-Latn` | 933 PENDING_NATIVE_REVIEW each, 0 REVIEWED |
| Flags | SAFETY 261, LEGAL 154, PRICE 83, PERMISSION 56; unflagged 434 |
| Format decisions pending | `pkr.grouping`, `pkr.digits`, `pkr.symbol`, `pkr.paisa` |
| Search aliases | 39 (en 11, ur 8, ur-Latn 20), all PROPOSED |

**Difference from the implementation record (931 strings: app 469, PRICE 81).** The two extra strings are
`rider.unavailable.LEGAL_GATE_DISABLED` and `rider.area.notYetTitle`. Both are PRICE-flagged and both came from the
R28 commit `49284fc`, after the record's count. The record's 931 is stale. The current export is 933.

## 2. The checker (reproducible, tested)

| File | Role |
|---|---|
| `apps/wayvro-mobile/scripts/i18n/prereview.ts` | Pure check functions, glossary, priority sheet, CSV/markdown rendering |
| `apps/wayvro-mobile/scripts/i18n/prereview-export.ts` | CLI: writes the hand-off pack |
| `apps/wayvro-mobile/scripts/i18n/prereview.test.ts` | Vitest: synthetic positive/negative cases per check plus a guard on the real catalogues |
| `apps/wayvro-mobile/scripts/i18n/review-package.ts` | Shared `csvDocument()` helper. Export CSV bytes and export id are unchanged. |
| `apps/wayvro-mobile/package.json` | New script `i18n:prereview` |

Run it with `pnpm --filter @wayvro/wayvro-mobile i18n:prereview` (optional `-- --out <folder>`). Two runs on the same
catalogues gave byte-identical files (all 8 files compared). The pack's copies of the review sheets match
`i18n-review/` byte for byte.

### Checks and how they decide

| Check | Codes (severity) | Rule |
|---|---|---|
| MISSING | `MISSING_KEY`, `EMPTY_TEXT`, `KEY_AS_TEXT`, `EXTRA_KEY` (ERROR) | Text missing, blank, equal to the key, or a key with no English source |
| PLACEHOLDER | `PLACEHOLDER_MISMATCH`, `PLACEHOLDER_MALFORMED` (ERROR) | `{name}` multiset differs from English. A stray `{` or `}`. |
| UNTRANSLATED | `SAME_AS_ENGLISH` (ur WARN / ur-Latn INFO), `NO_URDU_SCRIPT`, `LATIN_WORD_IN_URDU`, `ENGLISH_WORDS_IN_ROMAN_URDU` (WARN), `QUOTED_LATIN` (INFO) | Allow-list for brand/product/platform names (Wayvro, Google, Apple, Android, iPhone, OpenStreetMap), formats/units (JPEG, PNG, MB, LTV), codes (OTP, PKR, Rs, SMS, CNIC) and masks (`03XX`, `XXXXX-XXXXXXX-X`, `DD/MM/YYYY`). Some keys are untranslated on purpose, each with a reason (brand, endonyms, OSM attribution). The Roman-Urdu check uses English-only function words, excluding words that are also Roman Urdu (`is`, `to`, `in`, `on`, `no`). |
| BIDI | `BIDI_CONTROL_IN_TEXT` (ERROR), `BIDI_FIRST_STRONG_LATIN`, `BIDI_LTR_RUN_REORDERED`, `BIDI_RTL_IN_LTR_TEXT` (WARN), `BIDI_LATIN_ONLY_IN_RTL_UI` (INFO) | Follows the app's convention: `interpolate()` isolates every inserted value with FSI…PDI, and no isolation mark is ever typed into source. So placeholders count as isolated neutrals. Only *literal* runs are analysed, with a simplified UAX #9 (W2–W7, N1–N2, I2; no explicit embeddings). |
| PUNCTUATION | `END_PUNCTUATION_MISMATCH`, `END_PUNCTUATION_EXTRA`, `ASCII_PUNCTUATION_IN_URDU`, `URDU_PUNCTUATION_IN_ROMAN_URDU`, `ASCII_ELLIPSIS` (WARN) | English `.`/`?` maps to Urdu `۔`/`؟` and to Roman-Urdu `.`/`?`. `…` stays `…`. |
| NUMBER | `DIGITS_DIFFER`, `URDU_DIGITS` (WARN) | Digit groups must equal English (Arabic-Indic digits are normalised before comparing). Urdu digits conflict with the current `pkr.digits` decision (Western digits). |
| CURRENCY | `CURRENCY_WORD_DIFFERS` (WARN), `PKR_FORMAT_PENDING`, `SPOKEN_PRICE_WORDING` (INFO) | Rs/PKR/rupee words must be parallel to English. `{amount}` rows and `money.spoken*` rows are tied to the 4 pending decisions. |
| LENGTH | `OVER_BUDGET` (WARN), `OVER_BUDGET_SHORT_LABEL` (INFO, English ≤ 12 characters) | The documented limit is English length + 40 % (`PHASE3_MOBILE_UX_AND_NAVIGATION.md` §14 text expansion, the export's `max_length`). Length is counted in Unicode code points, so Urdu diacritics count. It approximates rendered width; it does not measure it. No per-screen pixel limits are documented. |
| TERMINOLOGY | `TERM_MINORITY_RENDERING` (WARN) | 33 repeated terms (fare, price, pickup, drop-off, ride, trip, rider, Driver/Partner, location, service, account, sign in, code, vehicle, document, licence, appeal, restriction, review, photo, selfie, earn, online/offline, map, mode, booking, Wayvro, and others). A row that uses a rendering other than the most common one is flagged. |

## 3. Results on the current catalogues (export `9f19b39b…`)

315 findings on 251 of the 933 strings. **0 ERROR findings.**

| Check | ERROR | WARN | INFO |
|---|---:|---:|---:|
| MISSING | 0 | 0 | 0 |
| PLACEHOLDER | 0 | 0 | 0 |
| UNTRANSLATED | 0 | 0 | 55 |
| BIDI | 0 | 7 | 1 |
| PUNCTUATION | 0 | 0 | 0 |
| NUMBER | 0 | 0 | 0 |
| CURRENCY | 0 | 0 | 6 |
| LENGTH | 0 | 125 | 100 |
| TERMINOLOGY | 0 | 21 | 0 |

Main points for the reviewer:

- **Bidi (WARN 7):**
  - Four SAFETY rows have an Urdu sentence that starts with a Latin word: `security.event.OIDC_LINKED`, `OIDC_UNLINKED`,
    `SIGN_IN_OIDC` ("Google یا Apple …") and `SESSIONS_REVOKED_BY_SUPPORT` ("Wayvro سپورٹ …"). A renderer that takes
    the paragraph direction from the first strong letter shows these lines left-to-right.
  - In `app:phone.hint` the literal `+92 3XX XXXXXXX` resolves to approximately `3XX XXXXXXX 92+` on screen, read left
    to right. The `+` moves, and the number splits.
  - In `driver:docs.body` and `driver:evidence.local.too-large`, `10 MB` resolves to `MB 10` read left to right. This is
    the usual right-to-left order; the reviewer should confirm it is acceptable.
  - INFO: `geo.attribution.OSM_ODBL` would display `©` on the far side if a component forced right-to-left.
  - All of these are predictions from the algorithm, not observations. Check them on the ur/ur-Latn screenshots in the
    emulator accessibility supplement.
- **Terminology (WARN 21 rows across 4 inconsistent terms):**

  | Term | ur renderings | ur-Latn renderings |
  |---|---|---|
  | rider | سوار ×7, رائیڈر ×5 | sawar ×7, Rider ×5 (the "Rider mode" labels use رائیڈر/Rider) |
  | location | مقام ×21 (consistent) | location ×16, maqam ×5 |
  | document | دستاویز ×44 (consistent) | dastavez ×39, English "Documents" ×5 (the `drive.row.documents*` labels) |
  | Wayvro | وے ورو ×68, Latin "Wayvro" ×1 (`security.event.SESSIONS_REVOKED_BY_SUPPORT`) | Wayvro ×69 |

  The other 29 terms each have one rendering. The full glossary is in the pack (`glossary.md` / `glossary.csv`).
- **Length:**
  - ur: 55 strings over budget, 40 of them short labels.
  - ur-Latn: 170 strings over budget, 60 of them short labels.
  - Median length ratio to English: ur 1.00, ur-Latn 1.18.
  - Largest ratios among the strings that are not short labels: `rider.quote.loading` (ur-Latn 2.20×) and
    `home.greeting` / `rider.home.greeting` (ur-Latn 1.92×).
  - The UX rule is that buttons wrap rather than truncate, so check these on screen. Do not cut them blindly.
- **Untranslated (INFO 55):**
  - 51 Roman-Urdu strings are identical to English. They are loanwords such as "Pickup", "Driver/Partner", "Bike" and
    "CNIC"; confirm they are what readers use.
  - 4 quoted Latin examples or labels: `'Liberty Market'`, `'Gulberg 3'` and `'Badshahi Masjid'` in the search hints,
    and the Android label "Allow all the time" in `drive.location.later`.
- **Currency (INFO 6):**
  - `fare.taxIncluded` (`{amount}`) and `money.spoken` / `money.spokenPaisa` (screen-reader "روپے"/"rupay" while the
    visible format is "Rs 1,250") are tied to the 4 pending decisions.
  - Most prices are formatted outside the catalogue by `money.ts` in `fare-view.ts` and `quote-view.ts`. Those must be
    judged on screenshots.
- **No findings:** punctuation (412 `۔` endings match the 412 English `.` endings; 13 `؟`; 76 `،`; no ASCII punctuation
  in Urdu), numbers (no Arabic-Indic digits; every digit group matches English), placeholders, missing keys, typed bidi
  controls.

## 4. Catalogue fixes

**None.** No mechanical defect was found. There is no placeholder mismatch, missing key, extra key, empty text,
malformed brace or typed bidi control. No catalogue file was edited, and no wording was changed. The new test
`FA-09 pre-review of the real catalogues › has no ERROR` keeps this as a regression guard. The existing catalogue
tests already enforce key parity and placeholder parity.

## 5. Hand-off pack

The pack is in `C:\Dev\Wayvro\evidence-local\fa09-prereview-pack\` (git-ignored, regenerate with
`i18n:prereview`):

- `README.md`
- `wayvro-strings-review.csv` and `wayvro-search-aliases-review.csv`: the official sheets, the ones to return
- `reviewer-priority-sheet.csv`: all 933 rows, ordered SAFETY 261 → LEGAL 126 → PRICE 83 → PERMISSION 29 → GENERAL 434.
  Each row goes to its highest flag, so LEGAL+SAFETY rows sit under SAFETY. Inside each group, rows with findings come
  first. The last column is `claude_suggestion_NOT_REVIEWED`, and there is no review-status column.
- `prereview-findings.csv`
- `glossary.csv` and `glossary.md`
- `prereview-summary.json`

## 6. Reviewer instructions (also in the pack README)

1. Read in the order of `reviewer-priority-sheet.csv`. Write decisions only in `wayvro-strings-review.csv`
   (OK / CHANGE / QUESTION), following `apps/wayvro-mobile/scripts/i18n/README.md` §2.
2. The automatic `check_codes`/`check_details` are hints and can be wrong. The `claude_suggestion_NOT_REVIEWED` column
   is machine text; never copy it without your own judgement.
3. Decide the four glossary terms marked **NO** once, then use them everywhere.
4. Check the bidi and length findings on the ur/ur-Latn screenshots before changing text: see the emulator
   accessibility supplement (produced separately).
5. Return the sheets with your name or initials, the date and the declaration. Only `i18n:import-review` plus a
   developer's ledger update can make a string REVIEWED.

## 7. Verification

| Command | Outcome |
|---|---|
| `pnpm --filter @wayvro/wayvro-mobile i18n:export` | PASS: 933 rows, export id above |
| `pnpm --filter @wayvro/wayvro-mobile i18n:prereview` (twice, compared) | PASS: byte-identical, 0 ERROR |
| `pnpm exec vitest run scripts/i18n` (in `apps/wayvro-mobile`) | PASS: 2 files, 24 tests (`review-package.test.ts` unchanged and passing, `prereview.test.ts` new) |
| `pnpm --filter @wayvro/wayvro-mobile typecheck` (includes `scripts/**`) | PASS (exit 0) |
| `pnpm exec eslint apps/wayvro-mobile/scripts/i18n` | PASS (exit 0, no problems) |
| `pnpm exec vitest run scripts/i18n src/core/i18n src/features/driver/i18n` | PASS: 6 files, 52 tests |
| `pnpm exec prettier --check` on the touched files | PASS |
| `pnpm exec knip --workspace apps/wayvro-mobile` | PASS (exit 0) |
| `pnpm exec knip --production --workspace apps/wayvro-mobile` | **FAILED (exit 1).** It reports `prereview.ts` and `prereview-export.ts` as unused files and `csvDocument` as an unused export, because `knip.jsonc` lists only `scripts/i18n/{export,import-review}.ts!` as production entries. Fix, outside this change's scope: add `prereview-export` to that entry glob. |

## 8. Limits (stated, not hidden)

- This is a heuristic, machine pre-review. It cannot judge meaning, tone, politeness, gender neutrality, safety
  ambiguity or legal accuracy. Those need the native reviewer (FA-09) and, for LEGAL rows, counsel.
- The bidi analysis is a simplified UAX #9 model. The real Android/iOS text stacks, and whether React Native honours
  `writingDirection` on Android, are not modelled. Device screenshots decide.
- The length budget counts characters. It does not measure glyph width or the actual screen layout.
- The term renderings come from the AI-drafted text. Listing them measures consistency; it does not approve any
  terminology.
