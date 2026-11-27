// Records uncaught Java/Kotlin exceptions (for example from the camera
// libraries) to the same file the JavaScript crash recorder reads
// (src/lib/crashRecorder.ts), so testers can share the stack trace from the
// "app closed unexpectedly" card without adb. Only the exception text and
// stack trace are written; nothing leaves the phone unless the user shares it.
const { withMainApplication } = require('expo/config-plugins');

const MARKER = '// edgevitals-java-crash-recorder';

const SNIPPET = `
    ${MARKER}
    run {
      val crashFile = java.io.File(filesDir, "last-crash.json")
      val stageFile = java.io.File(filesDir, "camera-running.json")
      val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, error ->
        try {
          // A JavaScript fatal error is recorded by the JS handler first and
          // then re-thrown here as a JavascriptException; keep the JS report.
          if (crashFile.exists()) throw IllegalStateException("already recorded")
          val trace = java.io.StringWriter()
          error.printStackTrace(java.io.PrintWriter(trace))
          val stage = try {
            if (stageFile.exists()) org.json.JSONObject(stageFile.readText()).optString("stage", "") else ""
          } catch (_: Throwable) { "" }
          val iso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
          }.format(java.util.Date())
          val report = org.json.JSONObject()
          report.put("kind", "native_error")
          report.put("at", iso)
          report.put("message", ("\${error.javaClass.name}: \${error.message} (thread \${thread.name})").take(2000))
          report.put("stack", trace.toString().take(12000))
          if (stage.isNotEmpty()) report.put("cameraStage", stage)
          crashFile.writeText(report.toString())
        } catch (_: Throwable) {
          // Never fail while handling a crash (or one is already recorded).
        }
        previousHandler?.uncaughtException(thread, error)
      }
    }
`;

module.exports = function withJavaCrashRecorder(config) {
  return withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withJavaCrashRecorder: expected a Kotlin MainApplication');
    }
    if (src.includes(MARKER)) return cfg;
    const anchor = /override fun onCreate\(\) \{\s*\n\s*super\.onCreate\(\)\n/;
    if (!anchor.test(src)) {
      throw new Error('withJavaCrashRecorder: could not find super.onCreate() in MainApplication');
    }
    cfg.modResults.contents = src.replace(anchor, (m) => m + SNIPPET);
    return cfg;
  });
};
