package com.dvnt.app.wear

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Geometry conveys admission state independently of color. No repeating animation. */
data class TicketRingState(val phase: String, val fraction: Float, val label: String) {
    val blocked get() = phase == "blocked"
}

fun WatchTicket.ringState(now: Long): TicketRingState {
    if (status.isUsed) return TicketRingState("admitted", 1f, "Checked in")
    if (!status.isPresentable) return TicketRingState("blocked", 0f, status.displayLabel)
    val doors = parseIso8601(eventDate) ?: return TicketRingState("scheduled", 1f, "Upcoming")
    val ends = parseIso8601(eventEndDate) ?: (doors + 8 * 60 * 60 * 1000L)
    if (now >= ends) return TicketRingState("blocked", 0f, "Event ended")
    if (now >= doors) return TicketRingState("open", 1f, "Doors are open")
    val remaining = doors - now
    if (remaining > 24 * 60 * 60 * 1000L) return TicketRingState("scheduled", 1f, "Upcoming")
    return TicketRingState("approaching", (1f - remaining / 86_400_000f).coerceIn(0f, 1f), "Doors approaching")
}

/** A changed sort order never changes the ticket being presented. */
fun selectedTicket(tickets: List<WatchTicket>, selectedId: String?): WatchTicket? =
    tickets.firstOrNull { it.id == selectedId } ?: tickets.firstOrNull()

/** Membership is the viewer's, so a pass bought for another person cannot claim it. */
fun WatchTicket.ownerMembership(membership: WatchMembership?): WatchMembership? =
    membership?.takeIf { isOwner == true }

@Composable
fun TicketAccessRing(state: TicketRingState, diameter: Dp, content: @Composable () -> Unit) {
    Box(Modifier.size(diameter).semantics { contentDescription = state.label }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val inset = 7.dp.toPx()
            val bounds = Size(size.width - inset * 2, size.height - inset * 2)
            val origin = Offset(inset, inset)
            drawArc(Dvnt.Surface.hairline, -90f, 360f, false, origin, bounds,
                style = Stroke(3.dp.toPx(), pathEffect = if (state.blocked) PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 5.dp.toPx())) else null))
            if (!state.blocked && state.fraction > 0f) {
                val brush = Dvnt.brandSweep(center)
                for ((width, opacity) in listOf(13f to .10f, 8f to .22f, 4f to 1f)) {
                    drawArc(brush, -90f, state.fraction * 360f, false, origin, bounds, alpha = opacity,
                        style = Stroke(width.dp.toPx(), cap = StrokeCap.Round))
                }
            }
        }
        content()
    }
}
