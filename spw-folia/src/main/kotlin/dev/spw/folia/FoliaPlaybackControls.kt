@file:OptIn(UnstableSpwWorkshopApi::class)
@file:Suppress("unused")

package dev.spw.folia

import com.xuncorp.spw.workshop.api.UnstableSpwWorkshopApi
import com.xuncorp.spw.workshop.api.WorkshopApi
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * v0.3.0 playback-bar controls and queue snapshot for the SPW host player.
 *
 * The host (SPW 1.19.0) player is not part of the Workshop API, so everything here is mapped
 * with `java.lang.reflect` against the *host's own* classloader. The mapping is frozen in
 * `docs/playback-controls.md` §2 (R8 build) and the whole layer is optional by design:
 *
 *  - the plugin does not compile against a single host class, only against class *names*;
 *  - every reflection failure is swallowed + logged (first hit in full, then throttled) — the
 *    bridge thread, the plugin lifecycle and the settings UI must never fail because the host
 *    version changed;
 *  - handles are resolved once (double-checked under [resolveLock], cached in @Volatile fields)
 *    and host state is re-read on every [queueJson], never cached.
 *
 * Wire format (docs/protocol.md §1/§2): the bridge owns stdin/stdout; this object only turns a
 * `{"t":"control",...}` line into host method calls and renders the current queue as the inner
 * JSON object of a `{"t":"queue",...}` line.
 */
internal object FoliaPlaybackControls {

    // ------------------------------------------------ host names (playback-controls.md §2) ----

    private const val CONTROLLER_CLASS = "com.xuncorp.voxzen.service.PlaybackController"
    private const val STATE_FLOW_CLASS = "kotlinx.coroutines.flow.StateFlow"
    private const val QUEUE_STATE_CLASS = "com.xuncorp.spc.core.queue.PlaybackQueueState"
    private const val QUEUE_MODE_CLASS = "com.xuncorp.spc.core.queue.PlaybackQueue\$Mode"
    /**
     * SPW 1.19.0 ground truth (docs/playback-controls.md §2 line 47, javap-verified): the queue
     * element is the *top-level* single-character class U+037F under `com.xuncorp.spc.core.queue`,
     * NOT a class called `PlaybackQueueItem` (that name does not exist in the host jar).
     */
    private const val QUEUE_ITEM_CLASS = "com.xuncorp.spc.core.queue.\u037F"
    private const val MEDIA_ITEM_CLASS = "com.xuncorp.pisces.PiscesMediaItem"

    private const val CONTROLLER_INSTANCE = "INSTANCE"
    private const val GET_QUEUE_STATE = "getPlaybackQueueState"
    private const val PLAY_OR_PAUSE = "playOrPause"
    private const val PREVIOUS = "previous"
    private const val NEXT = "next"
    private const val SEEK_TO = "seekTo"
    private const val CHANGE_PLAYBACK_MODE = "changePlaybackMode"
    private const val PLAY_MUSIC_AT = "playMusicAt"

    /**
     * R8-obfuscated member names kept as unicode escapes: U+037F is the single-character getter
     * name on every host class, U+0528..U+052B are the PlaybackQueueState accessors. Writing them
     * as escapes keeps this source ASCII-clean and immune to editor re-encoding.
     */
    private const val STATE_MODE = "\u037F"
    private const val STATE_NORMAL_QUEUE = "\u0528"
    private const val STATE_NORMAL_INDEX = "\u0529"
    private const val STATE_RANDOM_QUEUE = "\u052A"
    private const val STATE_RANDOM_INDEX = "\u052B"
    private const val ITEM_ID = "\u037F"
    private const val ITEM_DATA = "\u0528"
    private const val MEDIA_ID = "\u037F"
    private const val MEDIA_TITLE = "\u0528"
    private const val MEDIA_ARTIST = "\u0529"
    private const val MEDIA_ALBUM = "\u052A"

    private const val MODE_CIRCLE = "Circle"
    private const val MODE_RANDOM = "Random"

    /** Host enum name -> wire name (docs/protocol.md §1). Unknown/absent degrades to circle. */
    private val WIRE_MODES = mapOf(
        "Circle" to "circle",
        "CircleEnd" to "circle-end",
        "RepeatOne" to "repeat-one",
        "Random" to "random",
    )

    /** Back off between failed resolve attempts (host not fully up / class not loaded yet). */
    private const val RESOLVE_RETRY_MS = 5_000L

    // --------------------------------------------------------------- resolution state ----

    private val resolveLock = Any()

    @Volatile private var handlesCache: Handles? = null

    /** A missing host class is final for this plugin lifetime (SPW version guard failed). */
    @Volatile private var permanentlyUnavailable = false
    @Volatile private var lastResolveAttemptMs = 0L

    /** Set by [handleControl]; the bridge force-pushes the queue on its next pump tick. */
    private val queueDirtyFlag = AtomicBoolean(false)

    /**
     * Last non-random host mode seen before shuffle was switched on, restored when shuffle is
     * switched off again. Memory-only (per docs/playback-controls.md §3.1), defaults to Circle.
     */
    private val rememberedMode = AtomicReference<Any?>(null)

    private val failureCount = AtomicLong(0L)
    private val controlCount = AtomicLong(0L)
    private val loggedUnknownActions = ConcurrentHashMap<String, Boolean>()

    // ------------------------------------------------------------------ public surface ----

    /**
     * Executes one `{"t":"control","action":...}` line from the helper.
     *
     * Fire-and-forget: unknown actions and malformed arguments are ignored (logged once), and no
     * failure ever escapes into [FoliaHostBridge]'s stdout reader thread.
     */
    fun handleControl(line: String) {
        val action = try {
            Json.stringField(line, "action")
        } catch (_: Throwable) {
            null
        }
        if (action.isNullOrEmpty()) {
            logIgnoredControl("control line without action")
            return
        }
        val handles = handles()
        if (handles == null) {
            noteFailure("control:$action", IllegalStateException("host playback controls unavailable"))
            return
        }
        try {
            when (action) {
                "toggle" -> handles.playOrPause.invoke(handles.controller)
                "previous" -> handles.previous.invoke(handles.controller)
                "next" -> handles.next.invoke(handles.controller)
                "seek" -> {
                    val position = longField(line, "positionMs")
                    if (position == null) {
                        logIgnoredControl("seek without positionMs")
                        return
                    }
                    handles.seekTo.invoke(handles.controller, maxOf(0L, position))
                }
                "shuffle" -> invokeShuffle(handles)
                "queue-play" -> {
                    val index = longField(line, "index")
                    if (index == null || index < 0L || index > Int.MAX_VALUE.toLong()) {
                        logIgnoredControl("queue-play without a valid index")
                        return
                    }
                    handles.playMusicAt.invoke(handles.controller, index.toInt(), rawBoolean(line, "random"))
                }
                else -> {
                    logUnknownAction(action)
                    return
                }
            }
            // The player state machine applies asynchronously; the bridge re-reads on the next
            // pump tick (and the 500 ms diff catches anything that lands a moment later).
            queueDirtyFlag.set(true)
            logControl(action)
        } catch (t: Throwable) {
            noteFailure("control:$action", t)
        }
    }

    /**
     * Renders the current playback queue as the *body* of a `queue` line:
     * `{"mode":"circle|circle-end|repeat-one|random","random":bool,"index":int,"items":[...]}`.
     * Returns null when the host classes/members are unavailable (page keeps its last snapshot).
     */
    fun queueJson(): String? {
        val handles = handles() ?: return null
        return try {
            val state = readQueueState(handles) ?: return null
            val modeName = (handles.mode.invoke(state) as? Enum<*>)?.name
            val random = modeName == MODE_RANDOM
            val queue = (if (random) handles.randomQueue else handles.normalQueue).invoke(state)
            val index = ((if (random) handles.randomIndex else handles.normalIndex).invoke(state) as? Number)?.toInt() ?: -1
            buildQueueJson(handles, modeName, random, index, queue)
        } catch (t: Throwable) {
            noteFailure("queueJson", t)
            null
        }
    }

    /** Consumes the dirty flag; the bridge then pushes a queue snapshot on the next pump tick. */
    fun consumeQueueDirty(): Boolean = queueDirtyFlag.getAndSet(false)

    // --------------------------------------------------------------------- control impl ----

    /**
     * Shuffle toggle: host mode is Random -> restore the remembered non-random mode (default
     * Circle); otherwise remember the current mode and switch to Random.
     */
    private fun invokeShuffle(handles: Handles) {
        val current = currentMode(handles)
        val currentName = (current as? Enum<*>)?.name
        if (currentName == MODE_RANDOM) {
            val target = rememberedMode.get() ?: modeConstant(handles.modeClass, MODE_CIRCLE)
            if (target == null) {
                noteFailure("shuffle", IllegalStateException("PlaybackQueue.Mode.$MODE_CIRCLE not found"))
                return
            }
            handles.changePlaybackMode.invoke(handles.controller, target)
            FoliaPlugin.logStatic("playback shuffle off -> ${(target as? Enum<*>)?.name ?: MODE_CIRCLE}")
        } else {
            if (current != null) rememberedMode.set(current)
            val target = modeConstant(handles.modeClass, MODE_RANDOM)
            if (target == null) {
                noteFailure("shuffle", IllegalStateException("PlaybackQueue.Mode.$MODE_RANDOM not found"))
                return
            }
            handles.changePlaybackMode.invoke(handles.controller, target)
            FoliaPlugin.logStatic("playback shuffle on -> $MODE_RANDOM (remembered ${currentName ?: MODE_CIRCLE})")
        }
    }

    private fun currentMode(handles: Handles): Any? = try {
        readQueueState(handles)?.let { handles.mode.invoke(it) }
    } catch (t: Throwable) {
        noteFailure("readMode", t)
        null
    }

    /** Reads the live state: `getPlaybackQueueState().value` (never cached). */
    private fun readQueueState(handles: Handles): Any? {
        val stateFlow = handles.getQueueState.invoke(handles.controller) ?: return null
        return handles.stateValue.invoke(stateFlow)
    }

    private fun modeConstant(modeClass: Class<*>, name: String): Any? {
        val constants = try {
            modeClass.enumConstants
        } catch (_: Throwable) {
            null
        } ?: return null
        for (constant in constants) {
            if ((constant as? Enum<*>)?.name == name) return constant
        }
        return null
    }

    // --------------------------------------------------------------------- queue render ----

    private fun buildQueueJson(
        handles: Handles,
        modeName: String?,
        random: Boolean,
        index: Int,
        queue: Any?,
    ): String {
        val entries = queue as? List<*>
        val builder = StringBuilder(128 + (entries?.size ?: 0) * 96)
        builder.append("{\"mode\":").append(Json.str(wireMode(modeName)))
            .append(",\"random\":").append(Json.bool(random))
            .append(",\"index\":").append(index)
            .append(",\"items\":[")
        if (entries != null) {
            var first = true
            for (entry in entries) {
                if (entry == null) continue
                if (!first) builder.append(',')
                first = false
                appendQueueItem(builder, handles, entry)
            }
        }
        builder.append("]}")
        return builder.toString()
    }

    private fun appendQueueItem(builder: StringBuilder, handles: Handles, entry: Any) {
        val data = invokeQuietly(handles.itemData, entry)
        val internalId = (invokeQuietly(handles.itemId, entry) as? Number)?.toInt()
        val media = data?.takeIf { handles.mediaItemClass.isInstance(it) }
        val id = (media?.let { invokeQuietly(handles.mediaId, it) } as? String) ?: internalId?.toString() ?: ""
        builder.append("{\"id\":").append(Json.str(id))
            .append(",\"title\":").append(Json.str(mediaString(handles.mediaTitle, media)))
            .append(",\"artist\":").append(Json.str(mediaString(handles.mediaArtist, media)))
            .append(",\"album\":").append(Json.str(mediaString(handles.mediaAlbum, media)))
            .append('}')
    }

    private fun mediaString(method: Method, media: Any?): String {
        if (media == null) return ""
        return (invokeQuietly(method, media) as? String) ?: ""
    }

    private fun invokeQuietly(method: Method, target: Any): Any? = try {
        method.invoke(target)
    } catch (_: Throwable) {
        null
    }

    private fun wireMode(hostModeName: String?): String =
        hostModeName?.let { WIRE_MODES[it] } ?: "circle"

    // -------------------------------------------------------------------- line parsing ----

    private fun longField(line: String, key: String): Long? {
        val raw = Json.rawField(line, key)?.trim() ?: return null
        return raw.toLongOrNull() ?: raw.toDoubleOrNull()?.toLong()
    }

    private fun rawBoolean(line: String, key: String): Boolean {
        val raw = Json.rawField(line, key)?.trim()
        return raw == "true" || raw == "1"
    }

    // ----------------------------------------------------------------------- resolution ----

    private fun handles(): Handles? {
        handlesCache?.let { return it }
        if (permanentlyUnavailable) return null
        val now = System.currentTimeMillis()
        if (now - lastResolveAttemptMs < RESOLVE_RETRY_MS) return null
        synchronized(resolveLock) {
            handlesCache?.let { return it }
            if (permanentlyUnavailable) return null
            val attemptAt = System.currentTimeMillis()
            if (attemptAt - lastResolveAttemptMs < RESOLVE_RETRY_MS) return null
            lastResolveAttemptMs = attemptAt
            return try {
                val resolved = resolve()
                handlesCache = resolved
                logResolved(resolved)
                resolved
            } catch (t: Throwable) {
                // Missing class / failed class initialisation cannot recover inside this host
                // process; everything else (e.g. a method not found on a partially patched
                // build) is retried, throttled by RESOLVE_RETRY_MS.
                if (t is ClassNotFoundException || t is NoClassDefFoundError || t is ExceptionInInitializerError) {
                    permanentlyUnavailable = true
                }
                noteFailure("resolve", t)
                null
            }
        }
    }

    private fun resolve(): Handles {
        val (loader, controllerClass) = locateControllerClass()
        val controller = controllerInstance(controllerClass)
        val stateFlowClass = loadClass(STATE_FLOW_CLASS, loader)
        val queueStateClass = loadClass(QUEUE_STATE_CLASS, loader)
        val modeClass = loadClass(QUEUE_MODE_CLASS, loader)
        val queueItemClass = loadClass(QUEUE_ITEM_CLASS, loader)
        val mediaItemClass = loadClass(MEDIA_ITEM_CLASS, loader)

        return Handles(
            loader = loader,
            controller = controller,
            getQueueState = requireMethod(controllerClass, GET_QUEUE_STATE) { it.parameterCount == 0 },
            playOrPause = requireMethod(controllerClass, PLAY_OR_PAUSE) { it.parameterCount == 0 },
            previous = requireMethod(controllerClass, PREVIOUS) { it.parameterCount == 0 },
            next = requireMethod(controllerClass, NEXT) { it.parameterCount == 0 },
            seekTo = requireMethod(controllerClass, SEEK_TO) { method ->
                method.parameterCount == 1 && method.parameterTypes[0].let { isLongType(it) }
            },
            changePlaybackMode = requireMethod(controllerClass, CHANGE_PLAYBACK_MODE) { method ->
                method.parameterCount == 1 && method.parameterTypes[0].let { parameter ->
                    parameter == modeClass || parameter.isAssignableFrom(modeClass) || modeClass.isAssignableFrom(parameter)
                }
            },
            playMusicAt = requireMethod(controllerClass, PLAY_MUSIC_AT) { method ->
                method.parameterCount == 2 &&
                    method.parameterTypes[0].let { isIntType(it) } &&
                    method.parameterTypes[1].let { isBooleanType(it) }
            },
            stateFlowClass = stateFlowClass,
            stateValue = requireMethod(stateFlowClass, "getValue") { it.parameterCount == 0 },
            queueStateClass = queueStateClass,
            modeClass = modeClass,
            queueItemClass = queueItemClass,
            mediaItemClass = mediaItemClass,
            mode = requireMethod(queueStateClass, STATE_MODE) { isModeLike(it, modeClass) },
            normalQueue = requireMethod(queueStateClass, STATE_NORMAL_QUEUE) { isListLike(it) },
            normalIndex = requireMethod(queueStateClass, STATE_NORMAL_INDEX) { isIntGetter(it) },
            randomQueue = requireMethod(queueStateClass, STATE_RANDOM_QUEUE) { isListLike(it) },
            randomIndex = requireMethod(queueStateClass, STATE_RANDOM_INDEX) { isIntGetter(it) },
            itemId = requireMethod(queueItemClass, ITEM_ID) { isIntGetter(it) },
            itemData = requireMethod(queueItemClass, ITEM_DATA) { method ->
                method.parameterCount == 0 && !method.returnType.isPrimitive
            },
            mediaId = requireMethod(mediaItemClass, MEDIA_ID) { isStringLike(it) },
            mediaTitle = requireMethod(mediaItemClass, MEDIA_TITLE) { isStringLike(it) },
            mediaArtist = requireMethod(mediaItemClass, MEDIA_ARTIST) { isStringLike(it) },
            mediaAlbum = requireMethod(mediaItemClass, MEDIA_ALBUM) { isStringLike(it) },
        )
    }

    /**
     * Finds the classloader that can see the host classes: the Workshop API's loader first (the
     * host provides that class), then the context loader, then the plugin's own loader.
     */
    private fun locateControllerClass(): Pair<ClassLoader, Class<*>> {
        val candidates = LinkedHashSet<ClassLoader>()
        runCatching { WorkshopApi::class.java.classLoader }.getOrNull()?.let { candidates.add(it) }
        Thread.currentThread().contextClassLoader?.let { candidates.add(it) }
        FoliaPlaybackControls::class.java.classLoader?.let { candidates.add(it) }
        for (loader in candidates) {
            try {
                return loader to Class.forName(CONTROLLER_CLASS, false, loader)
            } catch (_: Throwable) {
                // Try the next loader; the full failure is logged below.
            }
        }
        throw ClassNotFoundException(
            "$CONTROLLER_CLASS not visible from ${candidates.size} classloader(s); " +
                "host classes are only present inside the SPW process"
        )
    }

    private fun loadClass(name: String, loader: ClassLoader): Class<*> = Class.forName(name, false, loader)

    /**
     * PlaybackController is a Kotlin `object`; its INSTANCE field also triggers the host class
     * initialisation (PlaybackService/BASS), which is why it is only touched from a live host.
     */
    private fun controllerInstance(controllerClass: Class<*>): Any {
        val instanceField: Field? = try {
            controllerClass.getDeclaredField(CONTROLLER_INSTANCE)
        } catch (_: Throwable) {
            controllerClass.declaredFields.firstOrNull { field ->
                Modifier.isStatic(field.modifiers) && field.type.isAssignableFrom(controllerClass)
            }
        }
        if (instanceField != null) {
            instanceField.trySetAccessible()
            instanceField.get(null)?.let { return it }
        }
        // Last resort: a static no-arg accessor/factory returning the object.
        for (method in controllerClass.methods) {
            if (!Modifier.isStatic(method.modifiers) || method.parameterCount != 0) continue
            if (!controllerClass.isAssignableFrom(method.returnType)) continue
            try {
                method.trySetAccessible()
                method.invoke(null)?.let { return it }
            } catch (_: Throwable) {
                // Keep looking.
            }
        }
        throw IllegalStateException("$CONTROLLER_CLASS has no reachable INSTANCE")
    }

    // ---------------------------------------------------------------- method lookups ----

    /**
     * Public API first (`getMethod`), then a declared-method walk up the hierarchy — R8 output is
     * public in this host, but the walk keeps the mapping working if that ever changes.
     */
    private fun findMethod(type: Class<*>, name: String, predicate: (Method) -> Boolean): Method? {
        val publicCandidates = try {
            type.methods.filter { it.name == name }
        } catch (_: Throwable) {
            emptyList()
        }
        publicCandidates.firstOrNull(predicate)?.let { return accessible(it) }
        var current: Class<*>? = type
        while (current != null && current != Any::class.java) {
            for (method in current.declaredMethods) {
                if (method.name == name && predicate(method)) return accessible(method)
            }
            current = current.superclass
        }
        return null
    }

    private fun requireMethod(type: Class<*>, name: String, predicate: (Method) -> Boolean): Method =
        findMethod(type, name, predicate)
            ?: throw NoSuchMethodException("${type.name}.$name")

    private fun accessible(method: Method): Method {
        method.trySetAccessible()
        return method
    }

    // ------------------------------------------------------- type / getter predicates ----

    private fun isLongType(type: Class<*>): Boolean =
        type == Long::class.java || type == Long::class.javaObjectType

    private fun isIntType(type: Class<*>): Boolean =
        type == Int::class.java || type == Int::class.javaObjectType

    private fun isBooleanType(type: Class<*>): Boolean =
        type == Boolean::class.java || type == Boolean::class.javaObjectType

    private fun isStringLike(method: Method): Boolean =
        method.parameterCount == 0 && method.returnType == String::class.java

    private fun isIntGetter(method: Method): Boolean =
        method.parameterCount == 0 && isIntType(method.returnType)

    private fun isListLike(method: Method): Boolean =
        method.parameterCount == 0 && Collection::class.java.isAssignableFrom(method.returnType)

    private fun isModeLike(method: Method, modeClass: Class<*>): Boolean =
        method.parameterCount == 0 &&
            (modeClass.isAssignableFrom(method.returnType) || Enum::class.java.isAssignableFrom(method.returnType))

    // -------------------------------------------------------------------------- logging ----

    private fun logResolved(handles: Handles) {
        FoliaPlugin.logStatic(
            "playback controls ready: loader=${handles.loader} controller=${handles.controller.javaClass.name} " +
                "queueState=${handles.queueStateClass.name} modeClass=${handles.modeClass.name} " +
                "itemClass=${handles.queueItemClass.name} mediaClass=${handles.mediaItemClass.name} " +
                "stateValue=${handles.stateFlowClass.name}.getValue()"
        )
    }

    private fun logControl(action: String) {
        val sent = controlCount.incrementAndGet()
        if (sent <= 10L || sent % 20L == 0L) FoliaPlugin.logStatic("playback control #$sent: $action")
    }

    private fun logUnknownAction(action: String) {
        if (loggedUnknownActions.putIfAbsent(action, true) == null) {
            FoliaPlugin.logStatic("playback control ignored: unknown action '$action'")
        }
    }

    private fun logIgnoredControl(reason: String) {
        val count = failureCount.incrementAndGet()
        if (count <= 3L || count % 100L == 0L) FoliaPlugin.logStatic("playback control ignored: $reason")
    }

    private fun noteFailure(where: String, t: Throwable) {
        val count = failureCount.incrementAndGet()
        if (count <= 3L || count % 100L == 0L) {
            FoliaPlugin.logStatic("playback controls: $where failed (#$count): ${t::class.java.name}: ${t.message}")
        }
    }

    // -------------------------------------------------------------------------- handles ----

    /** Immutable handle set; resolved once and published through [handlesCache]. */
    private class Handles(
        val loader: ClassLoader,
        val controller: Any,
        val getQueueState: Method,
        val playOrPause: Method,
        val previous: Method,
        val next: Method,
        val seekTo: Method,
        val changePlaybackMode: Method,
        val playMusicAt: Method,
        val stateFlowClass: Class<*>,
        val stateValue: Method,
        val queueStateClass: Class<*>,
        val modeClass: Class<*>,
        val queueItemClass: Class<*>,
        val mediaItemClass: Class<*>,
        val mode: Method,
        val normalQueue: Method,
        val normalIndex: Method,
        val randomQueue: Method,
        val randomIndex: Method,
        val itemId: Method,
        val itemData: Method,
        val mediaId: Method,
        val mediaTitle: Method,
        val mediaArtist: Method,
        val mediaAlbum: Method,
    )
}
