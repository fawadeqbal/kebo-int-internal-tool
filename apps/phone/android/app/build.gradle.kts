import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Push notifications need this app registered in Firebase (package dev.fawadiqbal.rfqdesk)
// and its google-services.json here. Without it the app builds and runs, with push off.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing: android/key.properties and the .jks it names (never committed).
// Local and CI test builds without it are signed with the debug key; the release workflow
// refuses to publish a debug-signed APK (see .github/workflows/phone-release.yml).
val keyProps = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "dev.fawadiqbal.rfq_desk"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Same id as the app it replaces (apps/app-v2), so v3 installs as an update over v2
        // when both are signed with the same release key.
        applicationId = "dev.fawadiqbal.rfqdesk"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // versionName and versionCode come from pubspec.yaml `version:` (see tool/version.dart).
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (keyProps.isNotEmpty()) {
                storeFile = rootProject.file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (keyProps.isNotEmpty()) "release" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
