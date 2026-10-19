import com.xuncorp.spw.workshop.gradle.PluginPermission
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("java-library")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.compose")
    // PF4J's annotation processor runs through kapt and generates META-INF/extensions.idx.
    // Without that index the host never instantiates @Extension classes (PlaybackExtensionPoint).
    id("org.jetbrains.kotlin.kapt")
    id("com.xuncorp.spw.workshop") version "0.1.0-dev23"
}

group = "dev.spw"
version = "0.1.2"

// A global init.gradle on this machine injects Aliyun mirrors into every project and
// thereby suppresses settings repos, so declare the repositories this build needs here.
repositories {
    maven("https://jitpack.io")
    mavenCentral()
    google()
}

java {
    sourceCompatibility = JavaVersion.VERSION_25
    targetCompatibility = JavaVersion.VERSION_25
}

kotlin {
    jvmToolchain(25)

    compilerOptions {
        jvmTarget = JvmTarget.JVM_25
        freeCompilerArgs.add("-Xjvm-default=all")
    }
}

dependencies {
    // Host already provides the Kotlin stdlib: compile against it, never bundle it.
    compileOnly(kotlin("stdlib"))

    // SPW Workshop API (host provides the implementation at runtime).
    compileOnly("com.github.Moriafly.spw-workshop-api:spw-workshop-api:0.1.0-dev23")

    // PF4J annotations (@Extension); the host ships the PF4J runtime.
    compileOnly("org.pf4j:pf4j:3.12.0")
    // PF4J extension index generation (kapt) — required so the host discovers our @Extension.
    kapt("org.pf4j:pf4j:3.12.0")
    kapt("com.github.Moriafly.spw-workshop-api:spw-workshop-api:0.1.0-dev23")

    // Compose: the host process owns the Compose runtime and the androidx.compose.* classes.
    // compileOnly => nothing is packaged into lib/, so the plugin runs against SPW's Compose
    // (bundling a second runtime would break Composer/Function2 class identity in hooks).
    compileOnly("org.jetbrains.compose.runtime:runtime-desktop:1.12.1")
    compileOnly("org.jetbrains.compose.foundation:foundation-desktop:1.12.1")
    compileOnly("org.jetbrains.compose.ui:ui-desktop:1.12.1")
}

// The canonical Folia settings tree ships as a plugin resource so the helper always receives a
// complete tree on first run (the plugin persists whatever the settings UI sends afterwards).
tasks.processResources {
    from(rootDir.parentFile.resolve("packaging/testdata/default-settings.json"))
}

// Plugin metadata -> written into classes/META-INF/MANIFEST.MF of the .spmod
spmod {
    PluginClass = "dev.spw.folia.FoliaPlugin"
    PluginId = "dev.spw.folia"
    PluginName = "spw-folia"
    PluginDescription = "Folia fullscreen lyric mode for Salt Player for Windows"
    PluginVersion = "0.1.2"
    PluginProvider = "dsh2 team"
    PluginHasConfig = false
    PluginPermissions = listOf(PluginPermission.CLASS_TRANSFORM, PluginPermission.LIBRARY_READ)
}

// ---------------------------------------------------------------------------------------------
// Local dev asset staging (task-7)
//
// The .spmod format only carries `classes/` + `lib/`, so the native helper and its web bundle are
// staged next to the plugin by scripts/install-local.sh:
//   <plugin dir>/host/spw-folia-host.exe + WebView2 dlls
//   <plugin dir>/web/index.html + assets + settings/settings-ui.js
//   <plugin dir>/web/default-settings.json
// Production packaging is a separate task; this task is the dev-only source of that layout.
// ---------------------------------------------------------------------------------------------
val repoRoot: File = rootDir.parentFile
val devHostDir = File(repoRoot, "poc/webview/host/build")
// packaging/native is re-staged by the host owner (task-9): prefer it over the dev checkout so
// local installs test exactly what ships.
val packagedNativeDir = File(repoRoot, "packaging/native")
val hostSrcDir = if (packagedNativeDir.isDirectory) packagedNativeDir else devHostDir
val devWebDir = File(repoRoot, "poc/webview/dist/dist")
val devSettingsDir = File(repoRoot, "poc/settings-ui/dist")
val devDefaultSettings = File(repoRoot, "packaging/testdata/default-settings.json")

val syncDevAssets by tasks.registering(Sync::class) {
    description = "Stages the native helper + Folia web bundle for local plugin installs."
    group = "spw-folia"
    into(layout.buildDirectory.dir("plugin-root"))
    from(hostSrcDir) {
        include(
            "spw-folia-host.exe",
            "spw-folia-host.exe.config",
            "WebView2Loader.dll",
            "Microsoft.Web.WebView2.Core.dll",
            "Microsoft.Web.WebView2.WinForms.dll"
        )
        into("host")
    }
    from(devWebDir) { into("web") }
    from(devSettingsDir) {
        include("settings-ui.js", "assets/**", "thumbs/**")
        into("web/settings")
    }
    from(devDefaultSettings) { into("web") }
    onlyIf { hostSrcDir.isDirectory && devWebDir.isDirectory }
}

tasks.named("plugin") {
    dependsOn(syncDevAssets)
}
