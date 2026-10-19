package dev.spw.folia

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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
    // Color sampled from SPW 1.19.0's own flyout labels/icons (#EBEEF1). The host
    // popup is a fixed dark flyout; the plain BasicText default (black) was the
    // reason the injected label used to look out of place.
    val contentColor = Color(0xFFEBEEF1)

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
