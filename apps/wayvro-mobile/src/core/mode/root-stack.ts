/**
 * Options of the ROOT native stack (src/app/_layout.tsx). Root-level route changes are state redirects (entry "/" →
 * mode home, → sign-in, → the session group), not user navigation, so they are not animated: on Android 10 the default
 * full-screen fade/scale renders both screens through screen-sized off-screen layers, and on the SP-02 reference device
 * (Galaxy A30) a slow account-state reply left ~50–58 MB of those GPU render targets cached on Rider home (PB-07;
 * docs/phase3/evidence/device/SP02_SAMSUNG_A30.md §8). Navigation inside a mode keeps its animations (nested stacks).
 */
export const ROOT_STACK_SCREEN_OPTIONS = { animation: 'none' } as const;
