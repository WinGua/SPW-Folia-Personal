package dev.spw.folia

import java.io.File
import java.lang.reflect.Method
import java.util.zip.ZipFile

/**
 * Host-version tolerant resolution of the two SPW internals this plugin has to reach:
 *
 *  1. the "更多" flyout's item-append helper (so a `Folia` entry can be injected), and
 *  2. the theme palette that supplies the flyout's content colour.
 *
 * Why this file exists
 * --------------------
 * SPW ships as an R8-obfuscated build, so every host release renames the classes/methods we touch.
 * Up to v0.3.0 the plugin hardcoded the SPW **1.19.0** names (`ē` / `ন` / `Ⴈ`) and refused to run
 * unless `spwVersion == "1.19.0"`, so 1.19.1/1.19.2 looked "unsupported" even though the host
 * structure is identical.
 *
 * Resolution is layered, cheapest first, and every layer is *validated by reflection* before use,
 * so a stale name can never be trusted blindly:
 *
 *  1. `host-targets.json` cache (keyed by host version) written after the last successful scan;
 *  2. built-in profiles for known host builds ([PROFILES]);
 *  3. a structural classpath scan that finds the helper by its *shape* — the parameter list
 *     `(Track, PiscesMediaItem, <PopupState>, Navigator, State, <MenuFlyoutScope>)` is unique in
 *     the host and three of those types are not obfuscated.
 *
 * The scan result is cached next to the plugin, so the slow path runs at most once per host build.
 */
internal object HostTargets {

    /** `1.19.2`, `1.20.0-beta1` → (1,20,0). Trailing junk is ignored; null = unparsable. */
    data class Version(val major: Int, val minor: Int, val patch: Int) : Comparable<Version> {
        override fun compareTo(other: Version): Int {
            if (major != other.major) return major - other.major
            if (minor != other.minor) return minor - other.minor
            return patch - other.patch
        }

        override fun toString(): String = "$major.$minor.$patch"

        companion object {
            /** Lowest host release whose flyout/layout this plugin targets. */
            val MIN_SUPPORTED = Version(1, 19, 0)

            private val PATTERN = Regex("""^\s*(\d+)\.(\d+)(?:\.(\d+))?""")

            fun parse(text: String?): Version? {
                if (text.isNullOrBlank()) return null
                val m = PATTERN.find(text) ?: return null
                val (a, b, c) = m.destructured
                return Version(a.toInt(), b.toInt(), c.toIntOrNull() ?: 0)
            }
        }
    }

    /**
     * Everything needed to append an item to the flyout on one host build.
     *
     * `addItemsParams` is the exact JVM parameter list `hookMethod` matches on; `scopeClass` /
     * `scopeBridge` locate the Kotlin default-argument bridge `MenuFlyoutScope.item(onClick,
     * content)`; `popupDismiss` (optional) closes the flyout after a click.
     */
    data class MenuTarget(
        val menuClass: String,
        val addItemsMethod: String,
        val addItemsParams: List<String>,
        val scopeClass: String,
        val scopeBridge: String,
        val popupStateClass: String?,
        val popupDismiss: String?,
        val origin: String,
    ) {
        /** `Track`, `PiscesMediaItem`, … in parameter order, for the log. */
        val shortSignature: String
            get() = addItemsParams.joinToString(", ") { it.substringAfterLast('.') }
    }

    /** `PaletteAccessor(Composer)` → palette object → `colorMethod(): Color(long)`. */
    data class PaletteTarget(
        val accessorClass: String,
        val accessorMethod: String,
        val paletteClass: String,
        val colorMethod: String,
        val origin: String,
    )

    // ------------------------------------------------------------------ profiles ----

    private const val TRACK = "com.xuncorp.voxzen.data.entity.Track"
    private const val MEDIA_ITEM = "com.xuncorp.pisces.PiscesMediaItem"
    private const val NAVIGATOR = "com.xuncorp.voxzen.ui.navigation.Navigator"
    private const val STATE = "androidx.compose.runtime.State"
    private const val COMPOSER = "androidx.compose.runtime.Composer"
    private const val FUNCTION0 = "kotlin.jvm.functions.Function0"
    private const val FUNCTION2 = "kotlin.jvm.functions.Function2"
    private const val MUTABLE_STATE = "Landroidx/compose/runtime/MutableState;"

    /**
     * Known host builds, newest first. The first profile whose classes and method signatures
     * validate wins; a profile is never applied on faith.
     *
     *  - `1.19.2` (Steam, 2026-10): verified by extracting `ffmpeg-x64.dll` and scanning classes.
     *  - `1.19.0` (Store / dev23 pairing): the original v0.1–v0.3 target.
     */
    private val PROFILES: List<MenuTarget> = listOf(
        MenuTarget(
            menuClass = "androidx.compose.ui.\u0918",              // घ — PlayerMoreMenuFlyoutKt
            addItemsMethod = "\u037F",                              // Ϳ
            addItemsParams = listOf(
                TRACK, MEDIA_ITEM,
                "androidx.compose.ui.\u0E30",                       // ะ — PopupState
                NAVIGATOR, STATE,
                "androidx.compose.ui.\u0538",                       // Ը — MenuFlyoutScope
            ),
            scopeClass = "androidx.compose.ui.\u0538",
            scopeBridge = "\u037F",
            popupStateClass = "androidx.compose.ui.\u0E30",
            popupDismiss = "\u0529",
            origin = "profile:1.19.2",
        ),
        MenuTarget(
            menuClass = "androidx.compose.ui.\u0113",               // ē (U+0113)
            addItemsMethod = "\u037F",
            addItemsParams = listOf(
                TRACK, MEDIA_ITEM,
                "androidx.compose.ui.\u10A8",                       // Ⴈ
                NAVIGATOR, STATE,
                "androidx.compose.ui.\u09A8",                       // ন
            ),
            scopeClass = "androidx.compose.ui.\u09A8",
            scopeBridge = "\u037F",
            popupStateClass = "androidx.compose.ui.\u10A8",
            popupDismiss = "\u0529",
            origin = "profile:1.19.0",
        ),
    )

    /**
     * Theme palette profile. Unchanged between 1.19.0 and 1.19.2 — the More-menu builder reads
     * `ʰ.Ԩ(composer).Ԩ()` for its item content colour in both builds.
     */
    private val PALETTE_PROFILES: List<PaletteTarget> = listOf(
        PaletteTarget(
            accessorClass = "androidx.compose.ui.\u02B0",           // ʰ
            accessorMethod = "\u0528",                              // Ԩ
            paletteClass = "androidx.compose.ui.\u0374",            // ʹ
            colorMethod = "\u0528",                                 // Ԩ
            origin = "profile:1.19.x",
        ),
    )

    // -------------------------------------------------------------------- state ----

    @Volatile
    var menu: MenuTarget? = null
        private set

    @Volatile
    var palette: PaletteTarget? = null
        private set

    @Volatile
    private var loadedFor: String? = null

    private val lock = Any()

    /** Scan diagnostics, appended to the plugin log when resolution fails. */
    @Volatile
    var lastDiagnostics: String = ""
        private set

    // -------------------------------------------------------------------- entry ----

    /**
     * Fast path: cache file, then built-in profiles — no classpath scan, so it is cheap enough to
     * run inside `start()`. Returns true when [menu] is usable.
     */
    fun quickLoad(pluginDir: File?, spwVersion: String, log: (String) -> Unit): Boolean {
        synchronized(lock) {
            if (menu != null && loadedFor == spwVersion) return true
            loadedFor = spwVersion
            menu = null

            if (palette == null) {
                palette = PALETTE_PROFILES.firstOrNull { validatePalette(it) }
                palette?.let { log("host palette ${it.origin}: ${it.paletteClass}.${it.colorMethod}()") }
            }

            readCache(pluginDir, spwVersion)?.let { cached ->
                if (validateMenu(cached)) {
                    menu = cached
                    log("host menu ${cached.origin}: ${cached.menuClass}.${cached.addItemsMethod}(${cached.shortSignature})")
                    return true
                }
                log("cached host menu target for $spwVersion no longer validates; re-resolving")
            }

            val profile = PROFILES.firstOrNull { validateMenu(it) }
            if (profile != null) {
                menu = profile
                log("host menu ${profile.origin}: ${profile.menuClass}.${profile.addItemsMethod}(${profile.shortSignature})")
                writeCache(pluginDir, spwVersion, profile, palette)
                return true
            }
            return false
        }
    }

    /**
     * Slow path: scan the host classpath for the helper by shape, then cache the result.
     * Safe to call from a background thread; returns null when nothing plausible was found.
     */
    fun deepResolve(pluginDir: File?, spwVersion: String, log: (String) -> Unit): MenuTarget? {
        synchronized(lock) {
            menu?.let { return it }
            val started = System.currentTimeMillis()
            val scanned = runCatching { scan(log) }.getOrElse { failure ->
                log("host scan failed: ${failure::class.java.name}: ${failure.message}")
                null
            }
            val took = System.currentTimeMillis() - started
            if (scanned == null) {
                log("host scan found no flyout helper (${took}ms) $lastDiagnostics")
                return null
            }
            if (!validateMenu(scanned)) {
                log("host scan candidate failed validation: ${scanned.menuClass}.${scanned.addItemsMethod} " +
                    "(${scanned.shortSignature}) (${took}ms)")
                return null
            }
            menu = scanned
            if (scanned.popupDismiss == null) {
                log("host scan: flyout dismiss unresolved; the popup may stay open behind the Folia window")
            }
            log("host menu scan: ${scanned.menuClass}.${scanned.addItemsMethod}(${scanned.shortSignature}) " +
                "scope=${scanned.scopeClass}.${scanned.scopeBridge} (${took}ms)")
            writeCache(pluginDir, spwVersion, scanned, palette)
            return scanned
        }
    }

    // -------------------------------------------------------------- validation ----

    private fun validateMenu(target: MenuTarget): Boolean = runCatching {
        val menuClass = Class.forName(target.menuClass)
        menuClass.declaredMethods.firstOrNull { m ->
            m.name == target.addItemsMethod &&
                m.parameterTypes.map { it.name } == target.addItemsParams
        } ?: return false

        val scopeClass = Class.forName(target.scopeClass)
        if (!scopeClass.isInterface) return false
        val bridge = scopeClass.declaredMethods.firstOrNull { m ->
            m.name == target.scopeBridge &&
                java.lang.reflect.Modifier.isStatic(m.modifiers) &&
                m.parameterTypes.size == 3 &&
                m.parameterTypes[0] == scopeClass &&
                m.parameterTypes[1].name == FUNCTION0 &&
                m.parameterTypes[2].name == FUNCTION2
        } ?: return false
        bridge.returnType == Void.TYPE
    }.getOrDefault(false)

    private fun validatePalette(target: PaletteTarget): Boolean = runCatching {
        val accessor = Class.forName(target.accessorClass)
        val method: Method = accessor.declaredMethods.firstOrNull { m ->
            m.name == target.accessorMethod &&
                java.lang.reflect.Modifier.isStatic(m.modifiers) &&
                m.parameterTypes.size == 1 &&
                m.parameterTypes[0].name == COMPOSER
        } ?: return false
        method.returnType.name == target.paletteClass &&
            method.returnType.declaredMethods.any {
                it.name == target.colorMethod && it.parameterCount == 0 &&
                    it.returnType == Long::class.javaPrimitiveType
            }
    }.getOrDefault(false)

    // ---------------------------------------------------------------- the scan ----

    /**
     * Walks `java.class.path` looking for the flyout helper.
     *
     * The zip **entry names of the SPW jar cannot be trusted** (several entries are aliased under a
     * name that differs from the class they contain), so every candidate is identified by the
     * value parsed out of the class file itself, never by its path.
     */
    private fun scan(log: (String) -> Unit): MenuTarget? {
        val classPath = System.getProperty("java.class.path").orEmpty()
        val roots = classPath.split(File.pathSeparatorChar).filter { it.isNotBlank() }
        log("host scan: ${roots.size} classpath entr(y/ies) [${roots.joinToString()}], matching by shape")

        val menuHits = ArrayList<MenuTarget>()
        val paletteHits = ArrayList<PaletteTarget>()
        var scanned = 0
        var parsed = 0

        fun consider(bytes: ByteArray) {
            scanned++
            val text = String(bytes, Charsets.ISO_8859_1)
            val maybeMenu = text.contains("com/xuncorp/voxzen/data/entity/Track")
            val maybePalette = text.contains(MUTABLE_STATE)
            val maybeAccessor = text.contains("(L$COMPOSER;)Landroidx/compose/ui/")
            if (!maybeMenu && !maybePalette && !maybeAccessor) return
            val cls = runCatching { parseClass(bytes) }.getOrNull() ?: return
            parsed++
            if (maybeMenu) menuHits += menuCandidates(cls)
            if (maybePalette) paletteColour(cls)?.let { paletteHits += it }
            if (maybeAccessor) paletteAccessor(cls)?.let { paletteHits += it }
        }

        for (root in roots) {
            val file = File(root)
            when {
                file.isDirectory -> file.walkTopDown()
                    .filter { it.isFile && it.name.endsWith(".class") }
                    .forEach { entry -> runCatching { consider(entry.readBytes()) } }

                file.isFile -> runCatching {
                    ZipFile(file).use { zip ->
                        for (entry in zip.entries()) {
                            val name = entry.name
                            if (!name.endsWith(".class")) continue
                            if (name.startsWith("META-INF/versions/")) continue
                            if (name == "module-info.class") continue
                            val bytes = zip.getInputStream(entry).use { it.readBytes() }
                            runCatching { consider(bytes) }
                        }
                    }
                }
            }
        }

        if (palette == null) {
            palette = pickPalette(paletteHits)?.takeIf { validatePalette(it) }
            palette?.let { log("host palette scan: ${it.paletteClass}.${it.colorMethod}() via ${it.accessorClass}") }
        }

        lastDiagnostics = "(classes=$scanned parsed=$parsed menuHits=${menuHits.size} paletteHits=${paletteHits.size})"

        for (candidate in menuHits) {
            val resolved = resolveParts(candidate) ?: continue
            if (validateMenu(resolved)) return resolved
        }
        return null
    }

    /** Every 6-argument method that looks like the flyout's "add the four items" helper. */
    private fun menuCandidates(cls: ParsedClass): List<MenuTarget> {
        val out = ArrayList<MenuTarget>(1)
        for (method in cls.methods) {
            val params = parameterTypes(method.desc) ?: continue
            if (params.size != 6) continue
            if (params[0] != TRACK || params[1] != MEDIA_ITEM) continue
            if (params[3] != NAVIGATOR || params[4] != STATE) continue
            if (!params[2].startsWith("androidx.compose.ui.")) continue
            if (!params[5].startsWith("androidx.compose.ui.")) continue
            out += MenuTarget(
                menuClass = cls.name,
                addItemsMethod = method.name,
                addItemsParams = params,
                scopeClass = "",
                scopeBridge = "",
                popupStateClass = null,
                popupDismiss = null,
                origin = "scan",
            )
        }
        return out
    }

    /**
     * Splits the two `androidx.compose.ui.*` parameters into (MenuFlyoutScope, PopupState) by
     * looking for the interface that carries the Kotlin default-argument item bridge.
     */
    private fun resolveParts(candidate: MenuTarget): MenuTarget? {
        val uiParams = listOf(candidate.addItemsParams[2], candidate.addItemsParams[5])
        for (name in uiParams) {
            val scopeClass = runCatching { Class.forName(name) }.getOrNull() ?: continue
            if (!scopeClass.isInterface) continue
            val bridge = scopeClass.declaredMethods.firstOrNull { m ->
                java.lang.reflect.Modifier.isStatic(m.modifiers) &&
                    m.returnType == Void.TYPE &&
                    m.parameterTypes.size == 3 &&
                    m.parameterTypes[0] == scopeClass &&
                    m.parameterTypes[1].name == FUNCTION0 &&
                    m.parameterTypes[2].name == FUNCTION2
            } ?: continue
            val other = uiParams.first { it != name }
            return candidate.copy(
                scopeClass = name,
                scopeBridge = bridge.name,
                popupStateClass = other,
                popupDismiss = resolveDismiss(other),
            )
        }
        return null
    }

    /**
     * `PopupState.dismiss()` — a no-arg void method. 1.19.x exposes two (`show`/`dismiss`), so the
     * known obfuscated name is preferred; when a build renames both we leave it unresolved rather
     * than invoke the wrong one (a flyout left open behind the fullscreen Folia window is cosmetic).
     */
    private fun resolveDismiss(popupClass: String): String? {
        val cls = runCatching { Class.forName(popupClass) }.getOrNull() ?: return null
        val candidates = cls.methods.filter {
            it.parameterCount == 0 && it.returnType == Void.TYPE &&
                !java.lang.reflect.Modifier.isStatic(it.modifiers)
        }
        if (candidates.isEmpty()) return null
        candidates.firstOrNull { it.name == "\u0529" }?.let { return it.name }
        return if (candidates.size == 1) candidates[0].name else null
    }

    // --------------------------------------------------------------- palette ----

    private fun paletteColour(cls: ParsedClass): PaletteTarget? {
        if (cls.mutableStateFields < 5) return null
        val getters = cls.methods.filter { it.desc == "()J" && !it.isStatic }
        if (getters.size < 5) return null
        // Content colour: the known 1.19.x accessor when present, else the second colour getter —
        // the palette's constructor order (background first, content second) has not changed
        // between 1.19.0 and 1.19.2, and this is only a fallback for unknown future builds.
        val content = getters.firstOrNull { it.name == "\u0528" } ?: getters.getOrNull(1) ?: return null
        return PaletteTarget(
            accessorClass = "",
            accessorMethod = "",
            paletteClass = cls.name,
            colorMethod = content.name,
            origin = "scan",
        )
    }

    private fun paletteAccessor(cls: ParsedClass): PaletteTarget? {
        val accessor = cls.methods.firstOrNull {
            it.isStatic && it.desc.startsWith("(L$COMPOSER;)Landroidx/compose/ui/") && it.desc.endsWith(";")
        } ?: return null
        val paletteClass = returnType(accessor.desc) ?: return null
        return PaletteTarget(
            accessorClass = cls.name,
            accessorMethod = accessor.name,
            paletteClass = paletteClass,
            colorMethod = "",
            origin = "scan",
        )
    }

    /** Pairs a scanned accessor with a scanned palette (they live in separate classes). */
    private fun pickPalette(hits: List<PaletteTarget>): PaletteTarget? {
        val cores = hits.filter { it.accessorClass.isEmpty() && it.colorMethod.isNotEmpty() }
        val accessors = hits.filter { it.accessorClass.isNotEmpty() }
        for (accessor in accessors) {
            val core = cores.firstOrNull { it.paletteClass == accessor.paletteClass } ?: continue
            return core.copy(
                accessorClass = accessor.accessorClass,
                accessorMethod = accessor.accessorMethod,
            )
        }
        return null
    }

    // ------------------------------------------------------------ class files ----

    private class ParsedMethod(val name: String, val desc: String, val isStatic: Boolean)

    private class ParsedClass(
        val name: String,
        val methods: List<ParsedMethod>,
        val mutableStateFields: Int,
    )

    /**
     * Minimal class-file reader: constant pool, this_class, fields (MutableState count) and
     * methods. Returns null for anything it does not fully understand — never throws.
     */
    private fun parseClass(bytes: ByteArray): ParsedClass? {
        if (bytes.size < 16 || u4(bytes, 0) != 0xCAFEBABE.toInt()) return null
        var i = 8
        val cpCount = u2(bytes, i)
        i += 2
        val utf = HashMap<Int, String>()
        val classRef = HashMap<Int, Int>()
        var index = 1
        while (index < cpCount) {
            when (val tag = bytes[i].toInt() and 0xFF) {
                1 -> {
                    val len = u2(bytes, i + 1)
                    utf[index] = String(bytes, i + 3, len, Charsets.UTF_8)
                    i += 3 + len
                }

                7 -> {
                    classRef[index] = u2(bytes, i + 1)
                    i += 3
                }

                8, 16, 19, 20 -> i += 3
                15 -> i += 4
                3, 4, 9, 10, 11, 12, 17, 18 -> i += 5
                5, 6 -> {
                    i += 9
                    index++
                }

                else -> return null
            }
            index++
        }

        val thisIndex = u2(bytes, i + 2)
        val nameIndex = classRef[thisIndex] ?: return null
        val className = utf[nameIndex] ?: return null
        i += 6
        val interfaces = u2(bytes, i)
        i += 2 + 2 * interfaces

        var mutableStates = 0
        val fieldCount = u2(bytes, i)
        i += 2
        repeat(fieldCount) {
            val descIndex = u2(bytes, i + 4)
            if (utf[descIndex] == MUTABLE_STATE) mutableStates++
            i += 6
            val attrs = u2(bytes, i)
            i += 2
            repeat(attrs) {
                val len = u4(bytes, i + 2)
                i += 6 + len
            }
        }

        val methods = ArrayList<ParsedMethod>(16)
        val methodCount = u2(bytes, i)
        i += 2
        repeat(methodCount) {
            val access = u2(bytes, i)
            val mName = utf[u2(bytes, i + 2)] ?: return null
            val mDesc = utf[u2(bytes, i + 4)] ?: return null
            val isStatic = access and 0x0008 != 0
            i += 6
            val attrs = u2(bytes, i)
            i += 2
            repeat(attrs) {
                val len = u4(bytes, i + 2)
                i += 6 + len
            }
            methods += ParsedMethod(mName, mDesc, isStatic)
        }
        return ParsedClass(className, methods, mutableStates)
    }

    private fun u2(b: ByteArray, at: Int): Int =
        ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)

    private fun u4(b: ByteArray, at: Int): Int =
        ((b[at].toInt() and 0xFF) shl 24) or
            ((b[at + 1].toInt() and 0xFF) shl 16) or
            ((b[at + 2].toInt() and 0xFF) shl 8) or
            (b[at + 3].toInt() and 0xFF)

    private fun returnType(desc: String): String? {
        val close = desc.indexOf(')')
        if (close < 0 || close + 1 >= desc.length) return null
        val ret = desc.substring(close + 1)
        if (!ret.startsWith("L") || !ret.endsWith(";")) return null
        return ret.substring(1, ret.length - 1).replace('/', '.')
    }

    private fun parameterTypes(desc: String): List<String>? {
        if (!desc.startsWith("(")) return null
        val out = ArrayList<String>(8)
        var i = 1
        while (i < desc.length && desc[i] != ')') {
            when (desc[i]) {
                'L' -> {
                    val end = desc.indexOf(';', i)
                    if (end < 0) return null
                    out += desc.substring(i + 1, end).replace('/', '.')
                    i = end + 1
                }

                '[' -> {
                    val start = i
                    while (i < desc.length && desc[i] == '[') i++
                    if (i < desc.length && desc[i] == 'L') {
                        val end = desc.indexOf(';', i)
                        if (end < 0) return null
                        out += desc.substring(start, end + 1).replace('/', '.')
                        i = end + 1
                    } else if (i < desc.length) {
                        out += desc.substring(start, i + 1)
                        i++
                    } else {
                        return null
                    }
                }

                'Z', 'B', 'C', 'S', 'I', 'J', 'F', 'D' -> {
                    out += when (desc[i]) {
                        'Z' -> "boolean"
                        'B' -> "byte"
                        'C' -> "char"
                        'S' -> "short"
                        'I' -> "int"
                        'J' -> "long"
                        'F' -> "float"
                        else -> "double"
                    }
                    i++
                }

                else -> return null
            }
        }
        return if (i < desc.length) out else null
    }

    // ------------------------------------------------------------------ cache ----

    private const val CACHE_FILE = "host-targets.json"

    private fun readCache(pluginDir: File?, spwVersion: String): MenuTarget? {
        val file = pluginDir?.let { File(it, CACHE_FILE) } ?: return null
        if (!file.isFile) return null
        return runCatching {
            val text = file.readText(Charsets.UTF_8)
            if (Json.stringField(text, "spwVersion") != spwVersion) return null
            val menuJson = Json.rawField(text, "menu") ?: return null
            val menuClass = Json.stringField(menuJson, "class") ?: return null
            val method = Json.stringField(menuJson, "method") ?: return null
            val paramsRaw = Json.rawField(menuJson, "params") ?: return null
            val scope = Json.stringField(menuJson, "scope") ?: return null
            val bridge = Json.stringField(menuJson, "bridge") ?: return null
            val params = paramsRaw.trim().removePrefix("[").removeSuffix("]")
                .split(""",""")
                .map { it.trim().trim('"') }
                .filter { it.isNotEmpty() }
            if (params.size != 6) return null
            MenuTarget(
                menuClass = menuClass,
                addItemsMethod = method,
                addItemsParams = params,
                scopeClass = scope,
                scopeBridge = bridge,
                popupStateClass = Json.stringField(menuJson, "popup"),
                popupDismiss = Json.stringField(menuJson, "dismiss"),
                origin = "cache",
            )
        }.getOrNull()
    }

    private fun writeCache(pluginDir: File?, spwVersion: String, menu: MenuTarget, palette: PaletteTarget?) {
        val dir = pluginDir ?: return
        runCatching {
            dir.mkdirs()
            val params = menu.addItemsParams.joinToString(",") { Json.str(it) }
            val paletteJson = palette?.let {
                "{\"accessor\":${Json.str(it.accessorClass)}," +
                    "\"accessorMethod\":${Json.str(it.accessorMethod)}," +
                    "\"palette\":${Json.str(it.paletteClass)},\"color\":${Json.str(it.colorMethod)}}"
            } ?: "null"
            val text = "{\"spwVersion\":${Json.str(spwVersion)}," +
                "\"menu\":{\"class\":${Json.str(menu.menuClass)}," +
                "\"method\":${Json.str(menu.addItemsMethod)},\"params\":[$params]," +
                "\"scope\":${Json.str(menu.scopeClass)},\"bridge\":${Json.str(menu.scopeBridge)}," +
                "\"popup\":${Json.str(menu.popupStateClass)},\"dismiss\":${Json.str(menu.popupDismiss)}}," +
                "\"palette\":$paletteJson}"
            File(dir, CACHE_FILE).writeText(text, Charsets.UTF_8)
        }
    }

    /** Drops in-memory state (used when the host version changes at runtime / by tests). */
    fun reset() {
        synchronized(lock) {
            menu = null
            palette = null
            loadedFor = null
        }
    }
}
