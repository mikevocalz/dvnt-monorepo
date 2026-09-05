package com.dvnt.app.wear

import android.graphics.Typeface
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography

/**
 * DVNT brand on Wear OS. The Android half of `apps/mobile/targets/watch/Theme.swift`
 * — same hexes, same floors, same names, so a member glancing from an Apple Watch to
 * a Pixel Watch to the phone never sees two brands.
 *
 * House rule: NOTHING in this module writes a raw `dp` or `sp` at a call site. Every
 * spatial or type value resolves to a token below. If a value is missing, add it here.
 *
 * Design references: `wear-os-design-guidelines`
 *   WR-CC-01 true-black canvas, WR-GL-03 type floors, WR-AM-01/03 ambient discipline.
 */
object Dvnt {

    /** WR-CC-01. Black pixels are free on OLED and buy the contrast for nothing. */
    val canvas = Color.Black

    // ---------------------------------------------------------------- Brand stops
    // docs/dvnt-design-system.md §1 — the phone's literal hexes.
    val cyan = Color(0xFF3FDCFF)
    val violet = Color(0xFF8A40CF)
    val magenta = Color(0xFFFF5BFC)
    val signal = Color(0xFFFC253A)
    val gold = Color(0xFFF5C518)

    /** Primary accent — cyan is stop 1 and the design system's "primary accent". */
    val accent = cyan

    val hairline = Color.White.copy(alpha = 0.10f)
    val textDim = Color.White.copy(alpha = 0.60f)
    val textFaint = Color.White.copy(alpha = 0.40f)

    /**
     * **The Deviant Gradient** — `linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%,
     * #FF5BFC 100%)`.
     *
     * It is spent on ONE focal element per screen and never behind a list or a
     * section. On the wrist that budget is the ring around the QR plate. Everywhere
     * else is flat [canvas] + [Surface.hairline] — a gradient behind a list lights
     * every pixel of an OLED panel for decoration, and this device is on a battery
     * that also has to survive a night out.
     *
     * 100° in CSS is measured clockwise from north, so the line runs left→right
     * with a slight upward tilt: (sin100°, −cos100°).
     */
    fun brandGradient(widthPx: Float, heightPx: Float): Brush = Brush.linearGradient(
        0.00f to cyan,
        0.52f to violet,
        1.00f to magenta,
        start = Offset(0.008f * widthPx, 0.413f * heightPx),
        end = Offset(0.992f * widthPx, 0.587f * heightPx),
    )

    /** The same three stops swept around a circle, wrapped back to cyan at the seam. */
    fun brandSweep(center: Offset): Brush = Brush.sweepGradient(
        0.00f to cyan,
        0.36f to violet,
        0.70f to magenta,
        1.00f to cyan,
        center = center,
    )

    /** Tier accent, matching the phone's TIER_ACCENT map. */
    fun tierAccent(tier: String?): Color = when (tier) {
        "free" -> cyan
        "vip" -> violet
        "table" -> magenta
        else -> Color(0xFF34A2DF) // ga
    }

    /** Status accent. Only `valid` is brand-coloured; everything else is muted. */
    fun statusAccent(status: TicketStatus): Color = when (status) {
        TicketStatus.VALID -> cyan
        TicketStatus.CHECKED_IN -> gold
        TicketStatus.TRANSFER_PENDING -> violet
        TicketStatus.REVOKED, TicketStatus.EXPIRED, TicketStatus.CANCELLED, TicketStatus.UNKNOWN -> signal
    }

    // ------------------------------------------------------------------- Surfaces
    /** Three steps and a hairline. Flat fills only — see [brandGradient]. */
    object Surface {
        val low = Color.White.copy(alpha = 0.04f)
        val mid = Color.White.copy(alpha = 0.06f)   // list row fill
        val high = Color.White.copy(alpha = 0.15f)  // inactive badge
        val hairline = Color.White.copy(alpha = 0.08f)
        /** The QR plate. A scanner needs a light field; this is the only non-black. */
        val code = Color(0xFFFFFFFF)
    }

    // --------------------------------------------------------------------- Radius
    object Radius {
        val chip: Dp = 10.dp
        val card: Dp = 14.dp
        val hero: Dp = 20.dp
    }

    // ---------------------------------------------------------------------- Space
    /** 4-based scale. Every magic number in this module resolves here. */
    object Space {
        val hair: Dp = 2.dp
        val tight: Dp = 4.dp
        val snug: Dp = 6.dp
        val base: Dp = 8.dp
        val roomy: Dp = 12.dp
        val loose: Dp = 16.dp
        /** Round-display safe inset for a full-width list (WR-RD-01/02). */
        val arc: Dp = 20.dp
    }

    // ---------------------------------------------------------------------- Sizes
    object Size {
        val minTouch: Dp = 48.dp        // WR-AC / Material minimum
        val tierDot: Dp = 10.dp
        val ringStroke: Dp = 3.dp
        val hairlineStroke: Dp = 1.dp
        val qrPlate: Dp = 116.dp        // the focal element on the detail screen
        val qrQuietZone: Dp = 8.dp
        val iconInline: Dp = 13.dp      // trailing metadata glyph
        val iconRow: Dp = 15.dp         // leading glyph on a list row
        val iconHero: Dp = 28.dp        // empty state / focal
    }

    // ----------------------------------------------------------------------- Type
    /**
     * Two registers with different jobs, ported 1:1 from `Theme.swift`.
     *
     * STRUCTURAL type — tier, status, "PRESENT AT DOOR", counts — is condensed and
     * tracked: venue vernacular (laminates, door signage), and it buys real
     * horizontal room on a 41mm round screen where "GENERAL ADMISSION" otherwise
     * truncates.
     *
     * CONTENT type — event names, times, venues — stays default width. Condensing
     * content hurts legibility at arm's length in the dark, which is the only
     * condition this app is ever used in.
     *
     * THE FLOORS ARE HARD (WR-GL-03, and the watchOS target's W-GL-03): body is
     * never below 16sp, titles never below 18sp. `caption` at 14sp is the single
     * register allowed under the body floor and is reserved for text nobody has to
     * read in order to act.
     */
    object Type {
        /** Android's stock condensed face. Present on every Wear OS system image. */
        val condensed: FontFamily = FontFamily(Typeface.create("sans-serif-condensed", Typeface.NORMAL))

        private val BODY_FLOOR = 16.sp
        private val TITLE_FLOOR = 18.sp

        /** Tracking for stamped labels. */
        val stampTracking = 1.4.sp

        /** Stamped structural label — tier, status, "PRESENT AT DOOR". Uppercase at
         *  the call site. 13sp condensed+heavy reads as signage, not body copy. */
        val stamp = TextStyle(
            fontFamily = condensed,
            fontSize = 13.sp,
            lineHeight = 15.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = stampTracking,
        )

        /** Screen and row titles. Floor 18sp. */
        val title = TextStyle(
            fontSize = TITLE_FLOOR,
            lineHeight = 22.sp,
            fontWeight = FontWeight.SemiBold,
        )

        /** Body copy: event names on the pass, host messages. Floor 16sp. */
        val body = TextStyle(
            fontSize = BODY_FLOOR,
            lineHeight = 20.sp,
            fontWeight = FontWeight.Normal,
        )

        /** Secondary metadata — dates, venue, staleness. Never load-bearing. */
        val caption = TextStyle(
            fontSize = 14.sp,
            lineHeight = 17.sp,
            fontWeight = FontWeight.Normal,
        )

        /** Countdowns and counts. Monospaced digits so a changing value never
         *  reflows the row it sits in. */
        val numeral = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 28.sp,
            lineHeight = 32.sp,
            fontWeight = FontWeight.Bold,
        )
    }

    // --------------------------------------------------------------------- Motion
    /**
     * One vocabulary so nothing reads as ad-hoc.
     *
     * NOTHING HERE REPEATS. A `repeatForever` animation keeps ticking off-screen and
     * in ambient, which is a battery bug you cannot see in an emulator (WR-AM-03).
     * If a looping affordance is ever needed, drive it from a state the screen can
     * stop, and stop it in `onEnterAmbient`.
     */
    object Motion {
        fun <T> enter(): FiniteAnimationSpec<T> =
            spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow)

        fun <T> settle(): FiniteAnimationSpec<T> =
            spring(dampingRatio = 0.90f, stiffness = Spring.StiffnessLow)

        fun <T> quick(): FiniteAnimationSpec<T> =
            tween(durationMillis = 180, easing = CubicBezierEasing(0.2f, 0f, 0f, 1f))

        /** Staggered list entrance, capped so a long list does not crawl in. */
        fun staggerMillis(index: Int): Int = minOf(index * 55, 400)
    }
}

private val DvntColors = ColorScheme(
    primary = Dvnt.cyan, primaryDim = Dvnt.cyan,
    secondary = Dvnt.violet, tertiary = Dvnt.magenta,
    background = Dvnt.canvas, surfaceContainer = Dvnt.Surface.mid,
    surfaceContainerLow = Dvnt.Surface.low, surfaceContainerHigh = Dvnt.Surface.high,
    error = Dvnt.signal, onPrimary = Color.Black, onSecondary = Color.White,
    onBackground = Color.White, onSurface = Color.White, onSurfaceVariant = Dvnt.textDim,
)
private val DvntTypography = Typography(
    titleLarge = Dvnt.Type.title, titleMedium = Dvnt.Type.title, titleSmall = Dvnt.Type.title,
    bodyLarge = Dvnt.Type.body, bodyMedium = Dvnt.Type.body, bodySmall = Dvnt.Type.caption,
    labelLarge = Dvnt.Type.body, labelMedium = Dvnt.Type.caption, labelSmall = Dvnt.Type.stamp,
    numeralLarge = Dvnt.Type.numeral,
)
@Composable
fun DvntWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = DvntColors, typography = DvntTypography, content = content)
}
