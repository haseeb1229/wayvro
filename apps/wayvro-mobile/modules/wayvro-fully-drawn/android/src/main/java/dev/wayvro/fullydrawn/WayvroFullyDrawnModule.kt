package dev.wayvro.fullydrawn

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * SP-02 §6.1 (PB-01/PB-02): reports the "interactive" moment of the first screen with Activity.reportFullyDrawn(), a
 * standard production lifecycle signal (Android vitals, Macrobenchmark). Android then logs
 * `Fully drawn <package>/<activity>: +<time>` measured from the same launch start as `am start -W`.
 *
 * At most once per process: the first caller (Rider home with "Where to?" enabled, or the sign-in screen) wins and every
 * later call returns false. No data leaves the device, nothing is stored, no permission is involved.
 */
class WayvroFullyDrawnModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WayvroFullyDrawn")

    Function("reportFullyDrawn") {
      val activity = appContext.currentActivity ?: return@Function false
      if (!reported.compareAndSet(false, true)) return@Function false
      activity.reportFullyDrawn()
      true
    }
  }

  private companion object {
    /** Process-wide: a JS reload or a new module instance never reports a second time. */
    val reported = AtomicBoolean(false)
  }
}
