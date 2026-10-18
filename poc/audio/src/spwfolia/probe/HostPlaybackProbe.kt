package spwfolia.probe

import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier

/**
 * Host playback position probe: reads a true 30-60 Hz playback position straight out of the
 * SPW host's media player via reflection, bypassing the Workshop API's ~1 Hz
 * `onPositionUpdated` callback.
 *
 * Reverse-engineering summary (1.19.0, from `work/audio/hostcls` + vineflower decompile; details in
 * `docs/audio-timeline.md`):
 *
 *  - `com.xuncorp.voxzen.service.PlaybackController` is a Kotlin `object` (static `INSTANCE` field),
 *    implements `PiscesMediaController`, and holds a private field `service` of type
 *    `com.xuncorp.voxzen.service.PlaybackService`.
 *  - `PlaybackService` extends a relocated/obfuscated base class (currently
 *    `androidx.compose.ui.ݱ`), which declares `public final val player: PiscesPlayer`, i.e. a
 *    **public** no-arg `getPlayer()` method returning `com.xuncorp.pisces.PiscesPlayer`.
 *  - `PiscesPlayer` is an abstract class with (among others) two `public abstract long` no-arg
 *    getters: `֏()` = current position and `ֈ()` = duration (milliseconds - validated against the
 *    1 Hz callback and media item duration).
 *  - The concrete implementation is `com.xuncorp.pisces.Ԩ` -> `BassPiscesPlayer` (BASS backend).
 *
 * Because R8 renames differ per build, the probe never hardcodes obfuscated method names:
 * it resolves the object graph structurally (by type name) and then identifies the position vs
 * duration getters by *signature* (`long ()`) plus a calibration hint from the 1 Hz
 * `onPositionUpdated` value. If nothing resolves, callers fall back to
 * [dev.spw.folia.PlaybackTimeline].
 *
 * This file intentionally depends on nothing but the JDK so it can be unit-tested against fake
 * host classes (`poc/audio/tests/.../HostPlaybackProbeTest.kt`).
 */
data class ProbeConfig(
    val controllerClassName: String = "com.xuncorp.voxzen.service.PlaybackController",
    val serviceClassName: String = "com.xuncorp.voxzen.service.PlaybackService",
    val playerClassName: String = "com.xuncorp.pisces.PiscesPlayer",
    val monitorClassName: String = "com.xuncorp.voxzen.service.PlaybackMonitor",
)

/** True high-rate position source; null results mean "probe temporarily unavailable". */
interface HostPositionSource {
    /** Player position in ms, or null when reflection/invocation failed. */
    fun pollPositionMs(): Long?

    /** Duration in ms if a matching getter was resolved. */
    fun pollDurationMs(): Long?

    /** Human-readable resolution result for logs/debug panels. */
    fun describe(): String
}

/**
 * Reflection helpers + the position-source factory. Every failure mode returns null instead of
 * throwing: the plugin must keep working with the 1 Hz timeline when the host build changes.
 */
object HostPlaybackProbe {

    /** Cached resolution so the 30-60 Hz poll path does no reflection lookup. */
    class ResolvedPlayer(
        val player: Any,
        val position: Method,
        val duration: Method?,
        val playerClass: String,
    ) {
        fun describe(): String =
            "player=${playerClass}, position=${signature(position)}, duration=" +
                (duration?.let { signature(it) } ?: "unresolved")
    }

    fun isHostPresent(config: ProbeConfig = ProbeConfig()): Boolean =
        loadClass(config.controllerClassName) != null

    /** Returns the `PlaybackController` singleton instance or null. */
    fun findController(config: ProbeConfig = ProbeConfig()): Any? {
        val controllerClass = loadClass(config.controllerClassName) ?: return null
        // Kotlin object: static INSTANCE field. Fall back to any static field of its own type.
        val instanceField = controllerClass.declaredFields.firstOrNull {
            Modifier.isStatic(it.modifiers) && it.name == "INSTANCE"
        } ?: controllerClass.declaredFields.firstOrNull {
            Modifier.isStatic(it.modifiers) && it.type.isAssignableFrom(controllerClass)
        }
        if (instanceField != null) {
            try {
                instanceField.isAccessible = true
                instanceField.get(null)?.let { return it }
            } catch (_: Throwable) {
            }
        }
        // Try companion object, then any public static factory with no args returning the type.
        for (m in controllerClass.methods) {
            if (Modifier.isStatic(m.modifiers) && m.parameterCount == 0 &&
                controllerClass.isAssignableFrom(m.returnType)
            ) {
                try {
                    m.isAccessible = true
                    m.invoke(null)?.let { return it }
                } catch (_: Throwable) {
                }
            }
        }
        return null
    }

    /** Returns the `PlaybackService` instance reachable from the controller, or null. */
    fun findService(config: ProbeConfig = ProbeConfig(), controller: Any? = findController(config)): Any? {
        if (controller == null) return null
        val serviceClassName = config.serviceClassName
        val serviceClass = loadClass(serviceClassName)

        // 1. Field of the service type (private val service: PlaybackService).
        for (field in walkFields(controller.javaClass)) {
            if (!typeMatches(field.type, serviceClassName, serviceClass)) continue
            try {
                field.isAccessible = true
                field.get(controller)?.let { return it }
            } catch (_: Throwable) {
            }
        }
        // 2. No-arg method returning the service type.
        for (method in walkMethods(controller.javaClass)) {
            if (method.parameterCount != 0) continue
            if (!typeMatches(method.returnType, serviceClassName, serviceClass)) continue
            try {
                method.isAccessible = true
                method.invoke(controller)?.let { return it }
            } catch (_: Throwable) {
            }
        }
        return null
    }

    /**
     * Returns the `PiscesPlayer` instance from the service's (inherited) `getPlayer()` or a field of
     * that type. The base class that declares the getter is an obfuscated app class, so the search
     * walks the whole superclass chain.
     */
    fun findPlayer(config: ProbeConfig = ProbeConfig(), service: Any? = findService(config)): Any? {
        if (service == null) return null
        val playerClassName = config.playerClassName
        val playerClass = loadClass(playerClassName)
        val candidates = walkMethods(service.javaClass).filter { m ->
            m.parameterCount == 0 && typeMatches(m.returnType, playerClassName, playerClass)
        }
        // Prefer obvious names (getPlayer/player) when R8 left them readable, else try them all.
        val ordered = candidates.sortedByDescending {
            val n = it.name.lowercase()
            when {
                n == "getplayer" -> 3
                n.contains("player") -> 2
                else -> 1
            }
        }
        for (method in ordered) {
            try {
                method.isAccessible = true
                method.invoke(service)?.let { return it }
            } catch (_: Throwable) {
            }
        }
        for (field in walkFields(service.javaClass)) {
            if (!typeMatches(field.type, playerClassName, playerClass)) continue
            try {
                field.isAccessible = true
                field.get(service)?.let { return it }
            } catch (_: Throwable) {
            }
        }
        return null
    }

    /**
     * Resolves the position/duration getters of [player].
     *
     * @param hint returns the latest 1 Hz `onPositionUpdated` value (ms) or null; used to tell the
     *   position getter apart from the duration getter the first time the probe runs. When null,
     *   a 150 ms two-sample heuristic tries to find the incrementing getter instead.
     */
    fun resolvePlayer(
        player: Any,
        config: ProbeConfig = ProbeConfig(),
        hint: (() -> Long?)? = null,
    ): ResolvedPlayer? {
        val candidates = longGetters(player)
        if (candidates.isEmpty()) return null

        // Sample all candidates twice to find the ones that change while playing.
        val first = HashMap<Method, Long>()
        for (m in candidates) invokeLong(m, player)?.let { first[m] = it }
        if (first.isEmpty()) return null
        try {
            Thread.sleep(120)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        val second = HashMap<Method, Long>()
        for (m in first.keys) invokeLong(m, player)?.let { second[m] = it }
        val incrementing = first.keys.filter { (first[it] ?: 0) != (second[it] ?: 0) }

        var position: Method? = null
        val hintValue = hint?.invoke()

        if (hintValue != null) {
            // Closest candidate to the authoritative 1 Hz callback wins (position or stale position).
            position = candidates.minByOrNull { m ->
                val v = second[m] ?: first[m] ?: Long.MAX_VALUE
                Math.abs(v - hintValue)
            }
            val bestDelta = second[position]?.let { Math.abs(it - hintValue) }
            // Reject absurd matches: a wrong getter (duration, device index...) will be far away.
            if (bestDelta != null && bestDelta > 10_000) position = null
        }
        if (position == null && incrementing.size == 1) position = incrementing.first()
        if (position == null && incrementing.size > 1) {
            // Prefer the smallest changing value (duration is usually larger); stable while paused.
            position = incrementing.minByOrNull { second[it] ?: Long.MAX_VALUE }
        }
        if (position == null) return null

        val posValue = second[position] ?: first[position] ?: 0L
        val duration = candidates
            .filter { it != position }
            .filter { m -> (second[m] ?: 0L) >= posValue - 1_000L }
            .maxByOrNull { second[it] ?: 0L }

        return ResolvedPlayer(player, position, duration, player.javaClass.name)
    }

    /** Full resolution path: controller -> service -> player -> getters. */
    fun resolve(
        config: ProbeConfig = ProbeConfig(),
        hint: (() -> Long?)? = null,
    ): ResolvedPlayer? {
        val controller = findController(config) ?: return null
        val service = findService(config, controller) ?: return null
        val player = findPlayer(config, service) ?: return null
        return resolvePlayer(player, config, hint)
    }

    /**
     * Position source for the plugin. Resolution happens lazily on first poll (so the host is fully
     * initialized) and is retried every 2 s after failures, at most 10 times, so a host update or a
     * late player construction cannot permanently break lyric sync.
     */
    fun createPositionSource(
        config: ProbeConfig = ProbeConfig(),
        hint: (() -> Long?)? = null,
    ): HostPositionSource = object : HostPositionSource {
        private var resolved: ResolvedPlayer? = null
        private var lastAttemptNanos = 0L
        private var attempts = 0
        private var failures = 0

        override fun pollPositionMs(): Long? {
            val r = ensureResolved() ?: return null
            val v = try {
                r.position.isAccessible = true
                invokeLong(r.position, r.player)
            } catch (_: Throwable) {
                null
            }
            if (v == null) {
                failures++
                if (failures >= 30) resolved = null
                return null
            }
            failures = 0
            return v
        }

        override fun pollDurationMs(): Long? {
            val r = ensureResolved() ?: return null
            val m = r.duration ?: return null
            return try {
                m.isAccessible = true
                invokeLong(m, r.player)
            } catch (_: Throwable) {
                null
            }
        }

        override fun describe(): String = resolved?.describe() ?: "unresolved (attempts=$attempts)"

        private fun ensureResolved(): ResolvedPlayer? {
            resolved?.let { return it }
            val now = System.nanoTime()
            if (attempts >= 10 || (lastAttemptNanos != 0L && now - lastAttemptNanos < 2_000_000_000L)) {
                return null
            }
            lastAttemptNanos = now
            attempts++
            resolved = resolve(config, hint)
            return resolved
        }
    }

    // --------------------------------------------------------------- reflection utils

    /** All no-arg methods of the player hierarchy that return long/Long and need no arg. */
    fun longGetters(player: Any): List<Method> =
        walkMethods(player.javaClass).filter { m ->
            m.parameterCount == 0 &&
                (m.returnType == java.lang.Long.TYPE || m.returnType == java.lang.Long::class.java)
        }.toList()

    fun invokeLong(method: Method, target: Any): Long? =
        try {
            method.isAccessible = true
            val value = method.invoke(target)
            (value as? Number)?.toLong()
        } catch (_: Throwable) {
            null
        }

    private fun loadClass(name: String): Class<*>? =
        try {
            Class.forName(name, false, HostPlaybackProbe::class.java.classLoader)
        } catch (_: Throwable) {
            null
        }

    private fun typeMatches(type: Class<*>, typeName: String, loaded: Class<*>?): Boolean {
        if (loaded != null && type.isAssignableFrom(loaded)) return true
        if (type.name == typeName) return true
        var current: Class<*>? = type
        while (current != null) {
            if (current.name == typeName) return true
            current = current.superclass
        }
        return false
    }

    private fun walkFields(start: Class<*>?): Sequence<Field> = sequence {
        var c = start
        while (c != null && c != Any::class.java) {
            for (f in c.declaredFields) yield(f)
            c = c.superclass
        }
    }

    private fun walkMethods(start: Class<*>?): Sequence<Method> = sequence {
        var c = start
        while (c != null && c != Any::class.java) {
            for (m in c.declaredMethods) yield(m)
            c = c.superclass
        }
    }

    private fun signature(m: Method): String = "${m.declaringClass.simpleName}.${m.name}()"

    /**
     * Optional second high-rate candidate: `PlaybackMonitor._lyricsTime` `StateFlow<Long>`
     * (updated by the host's lyrics renderer; update rate unverified on device - treat as a
     * bonus source and validate with the probe diagnostic before relying on it).
     */
    fun findMonitorLyricsTime(config: ProbeConfig = ProbeConfig()): Long? {
        val monitorClass = loadClass(config.monitorClassName) ?: return null
        val instanceField = monitorClass.declaredFields.firstOrNull {
            Modifier.isStatic(it.modifiers) && it.name == "INSTANCE"
        } ?: return null
        val monitor = try {
            instanceField.isAccessible = true
            instanceField.get(null)
        } catch (_: Throwable) {
            null
        } ?: return null
        for (m in walkMethods(monitor.javaClass)) {
            if (m.parameterCount != 0) continue
            val name = m.name.lowercase()
            if (!name.contains("lyricstime") && !name.contains("lyrics_time")) continue
            try {
                m.isAccessible = true
                val flow = m.invoke(monitor) ?: continue
                val valueMethod = flow.javaClass.methods.firstOrNull { it.name == "getValue" } ?: continue
                valueMethod.isAccessible = true
                val value = valueMethod.invoke(flow)
                (value as? Number)?.let { return it.toLong() }
            } catch (_: Throwable) {
            }
        }
        return null
    }
}
