/*
 * 为相机临时文件提供独立的 Android 组件身份，避免 Manifest 合并时覆盖应用已有的 FileProvider。
 */

package cn.flowcloudai.camera

import androidx.core.content.FileProvider

class FlowCameraFileProvider : FileProvider()
