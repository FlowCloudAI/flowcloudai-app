// Android 原生相机桥接模块；只依赖 Tauri Android 与 FileProvider 所在的 AndroidX Core。

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cn.flowcloudai.camera"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
}
