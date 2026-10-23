package dev.spw.folia

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.currentComposer
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.lang.reflect.Method

/**
 * Content of the injected "Folia" item inside SPW's mini-player 更多 flyout.
 *
 * SPW 1.19.0 renders its own four flyout items through `MenuFlyoutItemCompat`
 * (Blur.kt:326): a full-width row, vertically centered, with
 * `9.5.dp` leading spacer, optional `19.dp` tinted icon, `10.5.dp` spacer,
 * 14sp text, `11.dp` trailing spacer. Items without an icon use a `29.5.dp`
 * leading spacer so all labels align.
 *
 * This composable mirrors that layout exactly and adds a Folia sparkle icon, so
 * the injected item is indistinguishable from the host-owned items.
 */
@Composable
internal fun FoliaMenuItemContent() {
    // The host's own items do NOT hardcode a colour: MenuFlyoutItemCompat's contentColor
    // parameter defaults to `androidx.compose.ui.ʰ.Ԩ(composer).Ԩ()`, i.e. the content
    // colour of SPW's theme palette, which follows light/dark (v0.1.11 hardcoded the
    // dark-flyout sample #EBEEF1 and became invisible on the light flyout). We mimic the
    // exact host call through reflection so the injected item adapts the same way; if the
    // host internals ever change we silently fall back to the old constant.
    val contentColor = hostFlyoutContentColor() ?: Color(0xFFEBEEF1)

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(Modifier.width(9.5.dp))
        FoliaSparkle(
            modifier = Modifier.size(19.dp),
            color = contentColor,
        )
        Spacer(Modifier.width(10.5.dp))
        BasicText(
            text = "Folia",
            style = TextStyle(fontSize = 14.sp, color = contentColor),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(11.dp))
    }
}

/**
 * Reads SPW's theme palette object from the composition, then its content colour.
 *
 * `androidx.compose.ui.ʰ.Ԩ(Composer): androidx.compose.ui.ʹ` followed by `ʹ.Ԩ(): long` in 1.19.x —
 * the same two calls the host's `MenuFlyoutItemCompat` makes for its default `contentColor`. Both
 * are resolved per host build by [HostTargets] (and cached), so this keeps working when an SPW
 * update renames the palette classes.
 */
private val paletteAccessorMethod: Method? by lazy {
    runCatching {
        val target = HostTargets.palette ?: return@runCatching null
        Class.forName(target.accessorClass)
            .getDeclaredMethod(target.accessorMethod, androidx.compose.runtime.Composer::class.java)
            .apply { isAccessible = true }
    }.getOrNull()
}

/**
 * The palette's content colour, packed as a Compose [Color] long. The palette stores its colours in
 * `MutableState` fields, so reading it during composition also subscribes us to theme changes.
 */
private val paletteColorMethod: Method? by lazy {
    runCatching {
        val target = HostTargets.palette ?: return@runCatching null
        Class.forName(target.paletteClass)
            .getDeclaredMethod(target.colorMethod)
            .apply { isAccessible = true }
    }.getOrNull()
}

/** Current host flyout content colour, or null when the host theme API is unavailable. */
@Composable
private fun hostFlyoutContentColor(): Color? {
    val readPalette = paletteAccessorMethod ?: return null
    val readColor = paletteColorMethod ?: return null
    // `currentComposer` is a @Composable read, so it must happen outside runCatching
    // (the Compose compiler rejects composable calls inside it).
    val composer = currentComposer
    return runCatching {
        val palette = readPalette.invoke(null, composer) ?: return null
        Color((readColor.invoke(palette) as Long).toULong())
    }.getOrNull()
}

/** Folia's two-sparkle mark, drawn monochrome so it matches SPW's line icons. */
@Composable
private fun FoliaSparkle(modifier: Modifier, color: Color) {
    Canvas(modifier) {
        val s = size.minDimension

        // Four-point sparkle: alternating outer/inner vertices.
        fun sparkle(centerX: Float, centerY: Float, radius: Float) {
            val path = Path()
            val innerRatio = 0.24f
            repeat(8) { index ->
                val r = if (index % 2 == 0) radius else radius * innerRatio
                val angle = -Math.PI / 2.0 + index * Math.PI / 4.0
                val x = centerX + (r * Math.cos(angle)).toFloat()
                val y = centerY + (r * Math.sin(angle)).toFloat()
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            path.close()
            drawPath(path, color)
        }

        sparkle(centerX = s * 0.40f, centerY = s * 0.40f, radius = s * 0.40f)
        sparkle(centerX = s * 0.80f, centerY = s * 0.82f, radius = s * 0.15f)
    }
}
