/*
 * Android 移动壳层入口：衔接系统返回、WindowInsets、系统字号与 WebView。
 * 页面结构仍由共享 React 实现；这里只桥接 Android 独有的系统环境信号。
 */
package cn.flowcloudai.www

import android.content.ContentResolver
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.MimeTypeMap
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.math.abs

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var mobileSafeInsets: Insets = Insets.NONE
  @Volatile private var mobileKeyboardInsetCssPixels = 0f
  @Volatile private var mobileKeyboardVisible = false
  private var mobileImeAnimationDepth = 0
  private var mobileKeyboardPublishScheduled = false

  companion object {
    init {
      System.loadLibrary("app_lib")
    }
  }

  private external fun initRustlsPlatformVerifier()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initRustlsPlatformVerifier()
    super.onCreate(savedInstanceState)
    configureMobileWindowInsets()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackStarted(backEvent: BackEventCompat) {
        dispatchAndroidBackEvent("flowcloudai:android-back-start", backEvent.progress)
      }

      override fun handleOnBackProgressed(backEvent: BackEventCompat) {
        dispatchAndroidBackEvent("flowcloudai:android-back-progress", backEvent.progress)
      }

      override fun handleOnBackCancelled() {
        dispatchAndroidBackEvent("flowcloudai:android-back-cancel")
      }

      override fun handleOnBackPressed() {
        dispatchAndroidBackEvent("flowcloudai:android-back-invoked")
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    webView.addJavascriptInterface(MobileUiJavascriptBridge(), "flowcloudaiMobileUi")
    pushMobileUiEnvironment()
    scheduleMobileKeyboardInsetPush()
    ViewCompat.requestApplyInsets(window.decorView)
    if (AndroidRuntimeWorkarounds.isX86_64_16KbPageEnvironment) {
      // Android 16KB x86_64 模拟器上的 WebView/GPU 组合可能只渲染黑屏，改用软件层绘制。
      webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
      Log.w("MainActivity", "use software layer for WebView on x86_64 16KB environment")
    }
  }

  override fun onResume() {
    super.onResume()
    pushMobileUiEnvironment()
    scheduleMobileKeyboardInsetPush()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    pushMobileUiEnvironment()
    ViewCompat.requestApplyInsets(window.decorView)
  }

  private fun configureMobileWindowInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, windowInsets ->
      mobileSafeInsets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      /*
       * IME 动画开始后，系统会先把终点 Insets 送到布局，再开始派发中间帧。若这里把终点也
       * 推给页面，就会形成“终点 -> 中间帧 -> 终点”的回跳；动画期间只认 onProgress。
       */
      if (mobileImeAnimationDepth == 0) updateMobileKeyboardInset(windowInsets)
      pushMobileUiEnvironment()

      /*
       * WebView 始终保持全屏，不能再自行消费 IME，否则旧版 adjustResize 与新版 WebView
       * visual viewport 会和页面的 --fc-kb 形成双重避让。原始值已在上方读取，这里只对
       * 传给子 View 的 IME 类型归零。
       */
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .setVisible(WindowInsetsCompat.Type.ime(), false)
        .build()
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      window.decorView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onPrepare(animation: WindowInsetsAnimationCompat) {
          super.onPrepare(animation)
          if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
            mobileImeAnimationDepth += 1
          }
        }

        override fun onProgress(
          insets: WindowInsetsCompat,
          @Suppress("UNUSED_PARAMETER")
          runningAnimations: MutableList<WindowInsetsAnimationCompat>
        ): WindowInsetsCompat {
          if (mobileImeAnimationDepth > 0) updateMobileKeyboardInset(insets)
          return insets
        }

        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          super.onEnd(animation)
          if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return

          mobileImeAnimationDepth = (mobileImeAnimationDepth - 1).coerceAtLeast(0)
          if (mobileImeAnimationDepth == 0) {
            ViewCompat.getRootWindowInsets(window.decorView)?.let(::updateMobileKeyboardInset)
          }
        }
      }
    )
    ViewCompat.requestApplyInsets(window.decorView)
  }

  /** 把物理像素换算为 CSS 像素，只在数值确实变化时安排一帧 JS 写入。 */
  private fun updateMobileKeyboardInset(windowInsets: WindowInsetsCompat) {
    val density = resources.displayMetrics.density.coerceAtLeast(1f)
    val inset = windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      .coerceAtLeast(0) / density
    val visible = inset > 0f
    if (abs(inset - mobileKeyboardInsetCssPixels) < 0.05f
      && visible == mobileKeyboardVisible) return

    mobileKeyboardInsetCssPixels = inset
    mobileKeyboardVisible = visible
    scheduleMobileKeyboardInsetPush()
  }

  /** 同一显示帧内只执行一次 evaluateJavascript，并始终读取该帧最新的 Insets。 */
  private fun scheduleMobileKeyboardInsetPush() {
    val target = webView ?: return
    if (mobileKeyboardPublishScheduled) return
    mobileKeyboardPublishScheduled = true
    target.postOnAnimation {
      mobileKeyboardPublishScheduled = false
      if (webView !== target) return@postOnAnimation

      val inset = String.format(Locale.US, "%.2f", mobileKeyboardInsetCssPixels)
      val visible = mobileKeyboardVisible
      target.evaluateJavascript(
        "if (typeof window.__flowcloudaiApplyAndroidKeyboardInset === 'function') " +
          "window.__flowcloudaiApplyAndroidKeyboardInset($inset, $visible); true",
        null
      )
    }
  }

  private fun dispatchAndroidBackEvent(name: String, progress: Float? = null) {
    val detail = progress?.coerceIn(0f, 1f)?.let {
      String.format(Locale.US, "{ progress: %.4f }", it)
    }
    val event = if (detail == null) {
      "new Event('$name')"
    } else {
      "new CustomEvent('$name', { detail: $detail })"
    }
    webView?.evaluateJavascript("window.dispatchEvent($event); true", null)
  }

  private fun pushMobileUiEnvironment() {
    val target = webView ?: return
    val density = resources.displayMetrics.density.coerceAtLeast(1f)
    val fontScale = resources.configuration.fontScale.coerceIn(1f, 2f)
    val highContrast = Settings.Secure.getInt(
      contentResolver,
      "high_text_contrast_enabled",
      0
    ) == 1

    fun cssPixels(value: Int): String =
      String.format(Locale.US, "%.2fpx", value / density)

    val script = """
      (() => {
        const root = document.documentElement;
        root.style.setProperty('--mobile-native-inset-top', '${cssPixels(mobileSafeInsets.top)}');
        root.style.setProperty('--mobile-native-inset-right', '${cssPixels(mobileSafeInsets.right)}');
        root.style.setProperty('--mobile-native-inset-bottom', '${cssPixels(mobileSafeInsets.bottom)}');
        root.style.setProperty('--mobile-native-inset-left', '${cssPixels(mobileSafeInsets.left)}');
        root.style.setProperty('--mobile-font-scale', '$fontScale');
        root.dataset.mobileHighContrast = '$highContrast';
        const syncNativeTheme = () => {
          const theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
          window.flowcloudaiMobileUi?.setTheme(theme);
        };
        if (!window.__flowcloudaiMobileThemeObserver) {
          window.__flowcloudaiMobileThemeObserver = new MutationObserver(syncNativeTheme);
          window.__flowcloudaiMobileThemeObserver.observe(root, {
            attributes: true,
            attributeFilter: ['data-theme'],
          });
        }
        syncNativeTheme();
      })();
    """.trimIndent()

    target.post {
      target.evaluateJavascript(script, null)
    }
  }

  private inner class MobileUiJavascriptBridge {
    /** React 晚于首个 Insets 到达时，通过同步快照补齐当前值。 */
    @JavascriptInterface
    fun getKeyboardInset(): Double = mobileKeyboardInsetCssPixels.toDouble()

    @JavascriptInterface
    fun isKeyboardVisible(): Boolean = mobileKeyboardVisible

    @JavascriptInterface
    fun getNavigationMode(): String {
      val resourceId = resources.getIdentifier(
        "config_navBarInteractionMode",
        "integer",
        "android"
      )
      if (resourceId == 0) return "unknown"

      return when (resources.getInteger(resourceId)) {
        0, 1 -> "buttons"
        2 -> "gesture"
        else -> "unknown"
      }
    }

    @JavascriptInterface
    fun setTheme(theme: String) {
      runOnUiThread {
        val light = theme != "dark"
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = light
          isAppearanceLightNavigationBars = light
        }
      }
    }

    @JavascriptInterface
    fun haptic(kind: String) {
      runOnUiThread {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          getSystemService(Vibrator::class.java)
        } ?: return@runOnUiThread

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val effect = when (kind) {
            "success" -> VibrationEffect.EFFECT_DOUBLE_CLICK
            "warning" -> VibrationEffect.EFFECT_HEAVY_CLICK
            else -> VibrationEffect.EFFECT_TICK
          }
          vibrator.vibrate(VibrationEffect.createPredefined(effect))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(when (kind) {
            "warning" -> 35L
            "success" -> 24L
            else -> 12L
          })
        }
      }
    }
  }

  fun copyContentUriToDir(uriString: String, targetDirPath: String): String {
    val uri = Uri.parse(uriString)
    val targetDir = File(targetDirPath)
    targetDir.mkdirs()

    val extension = resolvePickedFileExtension(uri) ?: "bin"
    val target = File(targetDir, "${UUID.randomUUID()}.$extension")
    val input = contentResolver.openInputStream(uri)
      ?: throw IllegalArgumentException("无法打开已选择的图片")

    input.use { source ->
      target.outputStream().use { output ->
        source.copyTo(output)
      }
    }
    return target.absolutePath
  }

  fun copyFileToContentUri(sourcePath: String, uriString: String) {
    val uri = Uri.parse(uriString)
    val output = contentResolver.openOutputStream(uri, "w")
      ?: throw IllegalArgumentException("无法写入已选择的文件")

    File(sourcePath).inputStream().use { source ->
      output.use { target ->
        source.copyTo(target)
      }
    }
  }

  private fun resolvePickedFileExtension(uri: Uri): String? {
    val name = when (uri.scheme) {
      ContentResolver.SCHEME_FILE -> uri.path?.let { File(it).name }
      else -> resolveDisplayName(uri) ?: uri.lastPathSegment
    }
    val fromName = name
      ?.substringAfterLast('.', "")
      ?.lowercase()
      ?.takeIf { it.isNotBlank() && it.length <= 8 }
    return fromName ?: MimeTypeMap.getSingleton()
      .getExtensionFromMimeType(contentResolver.getType(uri))
      ?.lowercase()
  }

  private fun resolveDisplayName(uri: Uri): String? {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
    return runCatching {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
          val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    }.getOrNull()
  }
}
