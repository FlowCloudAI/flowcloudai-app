/*
 * Android 系统相机桥接：创建应用私有临时文件、授权外部相机写入，并把路径和图片元数据返回 Rust。
 * 本类不声明相机权限、不解码整张位图，也不负责将照片持久化到用户媒体目录。
 */

package cn.flowcloudai.camera

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.IOException
import java.util.UUID

@InvokeArg
class DiscardPhotoArgs {
    lateinit var tempPath: String
}

@TauriPlugin
class CameraPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingFile: File? = null
    private var pendingUri: Uri? = null

    init {
        pruneExpiredPhotos()
    }

    /** 一次只允许一个外部 Activity Result，避免 Tauri 的全局回调被后一次调用覆盖。 */
    @Command
    @Synchronized
    fun capture(invoke: Invoke) {
        if (pendingFile != null) {
            invoke.reject("已有拍照任务正在进行", "CAMERA_BUSY")
            return
        }

        var outputFile: File? = null
        var outputUri: Uri? = null
        try {
            val file = createOutputFile()
            outputFile = file
            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.flowcamera.fileprovider",
                file,
            )
            outputUri = uri

            val grantFlags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                clipData = ClipData.newRawUri("flow-camera-photo", uri)
                addFlags(grantFlags)
            }

            pendingFile = file
            pendingUri = uri
            startActivityForResult(invoke, intent, "captureResult")
        } catch (exception: Exception) {
            pendingFile = null
            pendingUri = null
            revokeUriPermission(outputUri)
            outputFile?.delete()
            invoke.reject("无法启动系统相机", "CAMERA_UNAVAILABLE", exception)
        }
    }

    @ActivityCallback
    @Synchronized
    fun captureResult(invoke: Invoke, result: ActivityResult) {
        val outputFile = pendingFile
        val outputUri = pendingUri
        pendingFile = null
        pendingUri = null
        revokeUriPermission(outputUri)

        if (outputFile == null) {
            invoke.reject("拍照结果已失效", "CAMERA_RESULT_MISSING")
            return
        }

        when (result.resultCode) {
            Activity.RESULT_OK -> resolveCapturedPhoto(invoke, outputFile)
            Activity.RESULT_CANCELED -> {
                outputFile.delete()
                invoke.reject("用户取消拍照", "CAMERA_CANCELLED")
            }
            else -> {
                outputFile.delete()
                invoke.reject("系统相机返回失败", "CAMERA_CAPTURE_FAILED")
            }
        }
    }

    /** 只允许删除本插件创建的缓存文件，避免把 WebView 传入的任意路径变成删除能力。 */
    @Command
    @Synchronized
    fun discard(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(DiscardPhotoArgs::class.java)
            val file = File(args.tempPath).canonicalFile
            val directory = cameraCacheDirectory().canonicalFile
            val isManagedFile = file.parentFile == directory && CAPTURE_FILE_PATTERN.matches(file.name)
            if (!isManagedFile) {
                invoke.reject("路径不属于相机临时目录", "CAMERA_INVALID_TEMP_PATH")
                return
            }
            if (pendingFile?.canonicalFile == file) {
                invoke.reject("拍照任务仍在使用该临时文件", "CAMERA_BUSY")
                return
            }
            if (file.exists() && !file.delete()) {
                throw IOException("无法删除相机临时文件")
            }
            invoke.resolve()
        } catch (exception: Exception) {
            invoke.reject("清理相机临时文件失败", "CAMERA_CLEANUP_FAILED", exception)
        }
    }

    private fun resolveCapturedPhoto(invoke: Invoke, outputFile: File) {
        try {
            if (!outputFile.isFile || outputFile.length() <= 0L) {
                throw IOException("系统相机没有写入图片")
            }

            // 只读取边界信息，不把高清图片完整解码进内存。
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(outputFile.absolutePath, options)
            if (options.outWidth <= 0 || options.outHeight <= 0) {
                throw IOException("无法解析系统相机返回的图片")
            }

            val response = JSObject().apply {
                put("tempPath", outputFile.absolutePath)
                put("mimeType", options.outMimeType ?: "image/jpeg")
                put("width", options.outWidth)
                put("height", options.outHeight)
                put("byteLength", outputFile.length())
            }
            invoke.resolve(response)
        } catch (exception: Exception) {
            outputFile.delete()
            invoke.reject("读取拍照结果失败", "CAMERA_INVALID_RESULT", exception)
        }
    }

    private fun createOutputFile(): File {
        val directory = cameraCacheDirectory()
        if (!directory.exists() && !directory.mkdirs()) {
            throw IOException("无法创建相机缓存目录")
        }
        return File(directory, "capture-${UUID.randomUUID()}.jpg").also {
            if (!it.createNewFile()) throw IOException("无法创建相机临时文件")
        }
    }

    private fun cameraCacheDirectory() = File(activity.cacheDir, "flow-camera")

    private fun revokeUriPermission(uri: Uri?) {
        if (uri == null) return
        try {
            activity.revokeUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        } catch (_: SecurityException) {
            // 某些厂商相机没有保留授权；目标文件仍位于应用私有缓存，无需扩大权限。
        }
    }

    /** 系统可能杀死相机返回前的进程；只清理超过一天、不会再被当前调用消费的遗留文件。 */
    private fun pruneExpiredPhotos() {
        val cutoff = System.currentTimeMillis() - ORPHAN_MAX_AGE_MS
        cameraCacheDirectory().listFiles()?.forEach { file ->
            val lastModified = file.lastModified()
            if (file.isFile && lastModified > 0L && lastModified < cutoff) file.delete()
        }
    }

    private companion object {
        val CAPTURE_FILE_PATTERN = Regex("^capture-[0-9a-fA-F-]{36}\\.jpg$")
        const val ORPHAN_MAX_AGE_MS = 24L * 60L * 60L * 1000L
    }
}
