package com.dvnt.app.wear.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import com.dvnt.app.wear.Dvnt
import com.dvnt.app.wear.WatchQrMatrix

/**
 * Paints the module grid the PHONE encoded. It does not encode anything.
 *
 * That is the whole point of shipping `qrMatrix` over the wire: one encoder, run
 * once on the phone at error-correction level "H", produces the bits that the
 * Apple Watch, this watch and the phone itself all draw. Two encoders can disagree
 * about mask pattern or version and produce two different-looking codes for one
 * token — which reads at a door as "the watch is broken".
 *
 * Fails CLOSED. If [WatchQrMatrix.modules] cannot rebuild a complete grid the view
 * draws nothing at all, because a half-drawn code still scans — as the wrong ticket.
 */
@Composable
fun QrMatrixView(
    matrix: WatchQrMatrix,
    size: Dp,
    modifier: Modifier = Modifier,
    /** Ambient drops to pure black-on-white: no scrim, no tint, no animation. It
     *  stays visible because the code IS the one important fact (WR-AM-04). */
    ambient: Boolean = false,
) {
    val modules = remember(matrix) { matrix.modules }
    val plate = if (ambient) Color.White else Dvnt.Surface.code
    val ink = Color.Black

    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(Dvnt.Radius.chip))
            .background(plate)
            .semantics {
                contentDescription = "Ticket QR code. Hold the watch to the scanner."
            },
    ) {
        if (modules == null) return@Box
        Canvas(
            modifier = Modifier
                .matchParentSize()
                // The quiet zone is part of the spec, not padding taste: without it
                // a scanner cannot find the finder patterns against a dark bezel.
                .padding(Dvnt.Size.qrQuietZone),
        ) {
            val n = matrix.size
            // Snap the module to whole pixels. Fractional module widths alias into
            // hairline gaps that a phone camera reads as light modules.
            val module = kotlin.math.floor(this.size.minDimension / n).coerceAtLeast(1f)
            val drawn = module * n
            val originX = (this.size.width - drawn) / 2f
            val originY = (this.size.height - drawn) / 2f
            val cell = Size(module, module)

            for (row in 0 until n) {
                var col = 0
                while (col < n) {
                    if (!modules[row * n + col]) {
                        col++
                        continue
                    }
                    // Coalesce horizontal runs into one rect: a 45x45 grid is 2025
                    // draw calls otherwise, on every recomposition, on a watch.
                    var run = 1
                    while (col + run < n && modules[row * n + col + run]) run++
                    drawRect(
                        color = ink,
                        topLeft = Offset(originX + col * module, originY + row * module),
                        size = cell.copy(width = module * run),
                    )
                    col += run
                }
            }
        }
    }
}
