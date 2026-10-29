# A11Y_EMULATOR_SUPPLEMENT — accessibility, RTL and bidi checks on an API 35 emulator (supplementary)

**Date:** 2026-10-17 · **Branch:** `phase-3/maps-quotes-unified-ux` (HEAD `ef3cbd0` + uncommitted work) · **Agent:** Claude Code
(self-audit, not independent verification).

> **Classification: `LOCAL_EMULATOR_SUPPLEMENTARY`.** This is emulator evidence only. It does **not** close:
> - FA-14 (TalkBack walkthrough on a physical Android device), which stays **OPEN / NOT RUN**;
> - FA-13 (VoiceOver on iPhone), which stays **NOT RUN**, with no claim of any kind;
> - FA-09 (native Urdu / Roman-Urdu review), which stays **OPEN**.
>
> The screenshots support a human reviewer. They do not replace one. All data on screen is synthetic: synthetic `+92399…`
> phones, the synthetic catalog and synthetic gazetteer places.

## 1. Set-up

| Item | Value |
|---|---|
| Emulator | `wayvro-sp02-api35-2g`: `system-images;android-35;google_apis;x86_64`, 2 GB, 2 cores, 720×1600 at 320 dpi |
| App | the CI-built release-mode E2E APK of this head (`evidence-local/apk/wayvro-e2e.apk`) against the synthetic stack (`tests/e2e-mobile/mobile-stack.mjs`, throwaway DB) |
| TalkBack | **present** on this image (`com.google.android.marvin.talkback`); nothing was downloaded |
| Walks | local Maestro walk flows (`evidence-local/laptop2/flows/a11y-walk-{rider,driver}.yaml`, not committed) driven per locale by `evidence-local/laptop2/a11y/scripts/run-walks.sh`; screenshots in `evidence-local/laptop2/a11y/walks/<walk>/` and copied to the FA-09 reviewer pack |
| Orientation | portrait only (`app.config.ts` `orientation: 'portrait'`), so landscape is out of scope |

## 2. Results

| Check | Result | Evidence |
|---|---|---|
| Rider walk, English: sign-in → OTP → Rider home → search → quote options → fare breakdown → account hub → security activity | **PASS** (16 screenshots) | `walks/rider-en/` |
| Rider walk, Urdu (right-to-left), new synthetic account created in Urdu: incl. policy acceptance and age declaration | **PASS** (18 screenshots); layouts mirror correctly, prices such as "Rs 389.90" keep their order inside Urdu rows | `walks/rider-ur/` |
| Rider walk, Roman Urdu | **PARTIAL**: sign-in, OTP and the policy screen captured; the walk's "accept" step did not scroll to the button below the fold (walk-flow limitation, not an app defect) | `walks/rider-urlatn/` |
| Rider walk, English at 200 % font scale (`font_scale 2.0`) | **PASS** (17 screenshots); text wraps, no clipped critical text seen on sign-in, Rider home, quote options (price, validity, "See fare details"), fare breakdown, account hub | `walks/rider-en-fs200/` |
| Driver/Partner walk (verified driver account): mode switch → Driver home → scroll | **PASS** in English (4 screenshots). The Urdu run rendered English because that seeded account's server `preferredLocale` is English (by design the server preference wins after sign-in; see §3) | `walks/driver-en/`, `walks/driver-ur/` |
| Accessibility tree of Rider home (`uiautomator dump`, hierarchy = default linear order) | 20 nodes; every interactive element has a label and a role (Button / CheckBox with checked state); order follows the visual order; **0 problems** (unlabelled clickable, off-screen) | `rider-home-en.xml` + `scripts/a11y-nodes.mjs` |
| TalkBack on the emulator | Enabled and bound (spoken, haptic, audible feedback); its focus landed on the first element ("Ride"). Synthetic `adb input swipe` gestures did **not** advance TalkBack focus, so a TalkBack linear walkthrough was **NOT RUN**; FA-14 (physical device) stays OPEN | `talkback/rider-home-en-*.png`, `-dumpsys-accessibility.txt` |
| Live region: search results count | Announced through the banner (`announce="search-results"`); its English text read "1 suggestions" — **defect, fixed** (§4) | `walks/rider-en/step-*.png` |
| Approximate-location permission dialog path | Covered by the CI E2E flows on API 35 (pr-07 deny, n-04/n-05/n-24) on every full-matrix run; not repeated here | CI run 38855394910 |

## 3. The eight automated bidi predictions, checked on screen

| Prediction (FA-09 pre-review) | Reachable? | Observed | Action |
|---|---|---|---|
| `phone.hint` "+92 3XX XXXXXXX" shown as "3XX XXXXXXX 92+" | yes (Urdu sign-in) | **confirmed** | fixed (§4) |
| — (not predicted) `otp.body` masked number "+92 3** *** **43" | yes (Urdu OTP screen) | **renders correctly** (number-only pixel crop, §5); the earlier "reversed" entry was a misreading — **withdrawn** | none needed |
| 3 × `security.event.*OIDC*` ("Google یا Apple …") | no — the new Urdu account has no OIDC events | not observed | stays a reviewer item |
| `SESSIONS_REVOKED_BY_SUPPORT` ("Wayvro سپورٹ …") | no — no such event on the synthetic accounts | not observed | stays a reviewer item |
| 2 × driver "10 MB" | no — applicant document screens not walked (the verified driver has no open application) | not observed | stays a reviewer item |
| OSM "©" attribution | no — the synthetic stack shows "SYNTHETIC_DATA" attribution | not observed | stays a reviewer item |

UX observation for the founder (not a defect): a language chosen on the sign-in screen applies to a **new** account (it is stored as the account's `preferredLocale` at creation), but an **existing** account switches to its saved server language after sign-in — documented in `locale-preference.ts`. Whether an explicit choice on the sign-in screen should update an existing account's preference is a product decision.

## 4. Defects fixed from this evidence (tests added)

1. **`phone.hint`**: the examples are now inserted values (`PHONE_FORMAT_EXAMPLES`), so they are isolated and "+92" stays in front (typed bidi controls are forbidden in the catalogue).
2. **"1 suggestions"**: a singular `rider.search.countOne` string in en/ur/ur-Latn (`search-view.ts` `resultCountKey`, test added). New copy is PENDING_NATIVE_REVIEW.

## 5. On-screen re-check — and withdrawal of the masked-number finding (2026-10-17)

The first version of this section reported the Urdu masked number (`otp.body`, also `phoneChange.codeBody` and `stepUp.sent`) as rendered right-to-left ("43** *** **3 92+"), and three bidi variants (LRI, LRE, LRM) as not fixing it. **That finding was wrong and is withdrawn.** It came from reading whole Urdu lines in full-screen screenshots; a left-to-right number inside a right-to-left line was misread.

The proof uses geometry and number-only pixel crops, never the reading of a mixed line:
- **Original CI build (`ef3cbd0`, the unchanged FIRST STRONG ISOLATE sentence).** A crop of only the number region of `walks/rider-ur/rider-ur-03-otp.png` shows **"+92 3** *** **01"** in order (`evidence-local/fix/crop-original-num.png`).
- **Diagnostic build that drew the value one character per text node.** The view hierarchy puts `+` at x = 389, `9` at 408 and so on up to `1` at 602, left to right; its crop shows the same correct order (`evidence-local/fix/crop-glyph.png`).
- **`phone.hint`, which WAS a real defect.** The original crop shows **"3XX XXXXXXX 92+"** (`evidence-local/fix/crop-hint-orig-num.png`). After the fix (format examples as isolated inserted values), it shows **"+92 3XX XXXXXXX"** (`evidence-local/fix/crop-hint-new-num.png`).

All diagnostic rendering changes (LRI, LRE and LRM marks, split and per-character rendering) were **reverted**. The masked-number sentence stays exactly as in `4bf4803`: `t()` with the FIRST STRONG ISOLATE that `interpolate()` already applies. The `phone.hint` and singular-count fixes stay.

Lesson recorded for future evidence: judge mixed-direction rendering only from number-only crops or view geometry.
