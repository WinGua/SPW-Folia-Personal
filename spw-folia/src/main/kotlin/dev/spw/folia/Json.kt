package dev.spw.folia

import java.util.Locale

/**
 * Tiny JSON helpers.
 *
 * The plugin deliberately bundles no JSON library: the workshop API is compileOnly and the
 * helper protocol only needs (a) escaping strings when building lines and (b) pulling raw
 * JSON sub-values out of incoming lines without re-serialising them (the settings tree must
 * round-trip byte-identically).
 */
internal object Json {

    fun esc(text: String): String {
        val sb = StringBuilder(text.length + 16)
        for (c in text) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '\n' -> sb.append("\\n")
                c == '\r' -> sb.append("\\r")
                c == '\t' -> sb.append("\\t")
                c.code < 0x20 -> sb.append(String.format(Locale.ROOT, "\\u%04x", c.code))
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    fun str(value: String?): String = if (value == null) "null" else "\"" + esc(value) + "\""

    fun num(value: Double): String {
        if (value.isNaN() || value.isInfinite()) return "0"
        if (value == value.toLong().toDouble()) return value.toLong().toString()
        return String.format(Locale.ROOT, "%.3f", value).trimEnd('0').trimEnd('.')
    }

    fun bool(value: Boolean): String = if (value) "true" else "false"

    /**
     * Returns the raw JSON text (object / array / scalar) stored under [key] in [json],
     * or null when the key is absent. String aware and brace balanced.
     */
    fun rawField(json: String, key: String): String? {
        val needle = "\"" + key + "\""
        var at = json.indexOf(needle)
        while (at >= 0) {
            var i = at + needle.length
            while (i < json.length && json[i].isWhitespace()) i++
            if (i < json.length && json[i] == ':') {
                i++
                while (i < json.length && json[i].isWhitespace()) i++
                if (i >= json.length) return null
                val start = i
                if (json[i] == '{' || json[i] == '[') {
                    var depth = 0
                    var inString = false
                    var escaped = false
                    while (i < json.length) {
                        val c = json[i]
                        if (inString) {
                            when {
                                escaped -> escaped = false
                                c == '\\' -> escaped = true
                                c == '"' -> inString = false
                            }
                        } else {
                            when (c) {
                                '"' -> inString = true
                                '{', '[' -> depth++
                                '}', ']' -> {
                                    depth--
                                    if (depth == 0) return json.substring(start, i + 1)
                                }
                            }
                        }
                        i++
                    }
                    return null
                }
                if (json[i] == '"') {
                    i++
                    var escaped = false
                    while (i < json.length) {
                        val c = json[i]
                        if (escaped) {
                            escaped = false
                        } else if (c == '\\') {
                            escaped = true
                        } else if (c == '"') {
                            return json.substring(start, i + 1)
                        }
                        i++
                    }
                    return null
                }
                while (i < json.length) {
                    val c = json[i]
                    if (c == ',' || c == '}' || c == ']' || c.isWhitespace()) break
                    i++
                }
                return json.substring(start, i)
            }
            at = json.indexOf(needle, at + 1)
        }
        return null
    }

    /** Extracts the (unescaped) string value of [key] from a flat JSON object line. */
    fun stringField(json: String, key: String): String? {
        val raw = rawField(json, key) ?: return null
        if (raw.length < 2 || raw[0] != '"') return null
        val sb = StringBuilder(raw.length)
        var i = 1
        while (i < raw.length - 1) {
            val c = raw[i]
            if (c == '\\' && i + 1 < raw.length - 1) {
                i++
                when (val n = raw[i]) {
                    'n' -> sb.append('\n')
                    'r' -> sb.append('\r')
                    't' -> sb.append('\t')
                    'b' -> sb.append('\b')
                    'f' -> sb.append('\u000c')
                    'u' -> {
                        if (i + 4 < raw.length) {
                            val code = raw.substring(i + 1, i + 5).toIntOrNull(16)
                            if (code != null) {
                                sb.append(code.toChar())
                                i += 4
                            }
                        }
                    }
                    else -> sb.append(n)
                }
            } else {
                sb.append(c)
            }
            i++
        }
        return sb.toString()
    }
}
