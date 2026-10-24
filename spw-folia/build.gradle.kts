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
// CI test builds set SPW_FOLIA_VERSION=0.3.2-test so the patched .spmod installs beside a release
// build instead of looking like the already-installed 0.3.1. An environment variable is used
// because a Windows .bat wrapper splits "-Pname=value" at '=', which Gradle then reads as a task.
version = providers.environmentVariable("SPW_FOLIA_VERSION")
    .orElse(providers.gradleProperty("spwFoliaVersion"))
    .getOrElse("0.3.1")

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
    PluginVersion = version.toString()
    PluginProvider = "azkbzxf"
    PluginHasConfig = false
    PluginOpenSourceUrl = "https://github.com/azkbzxf/spw-folia"
    // v0.3.2: KEY_BINDINGS backs the user-configurable open/close shortcut (SPW 快捷键管理).
    PluginPermissions = listOf(
        PluginPermission.CLASS_TRANSFORM,
        PluginPermission.LIBRARY_READ,
        PluginPermission.KEY_BINDINGS
    )
}

// Local-dev asset staging lives outside this repo: cloud builds take the web bundle from the
// pinned base package, and the helper output is packaged by .github/scripts/assemble-spmod.py.
