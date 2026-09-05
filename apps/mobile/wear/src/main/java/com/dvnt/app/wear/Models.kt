package com.dvnt.app.wear

import org.json.JSONArray
import org.json.JSONObject

/**
 * The wire types the Wear app consumes. These are the Kotlin half of ONE schema:
 *
 *   `packages/app/features/watch/watch-payload.ts`   <- the producer (phone, TS)
 *   `apps/mobile/targets/watch/Models.swift`          <- the Apple Watch consumer
 *   this file                                          <- the Wear OS consumer
 *
 * There is deliberately no second Android-only schema. The phone builds one
 * envelope and both wrists render it, which is also why `qrMatrix` exists (see
 * [WatchQrMatrix]).
 *
 * Parsing is by hand with `org.json` rather than kotlinx-serialization: it is in
 * the platform, it costs no plugin and no extra dex, and — more importantly — it
 * lets every field fail open individually. The Swift side decodes leniently for
 * the same reason: a ticket must never be dropped because one optional field
 * arrived in a shape we did not expect.
 */

/** Mirrors `TicketStatus` in Models.swift / `WatchTicketStatus` in watch-payload.ts. */
enum class TicketStatus(val wire: String) {
    VALID("valid"),
    CHECKED_IN("checked_in"),
    REVOKED("revoked"),
    EXPIRED("expired"),
    TRANSFER_PENDING("transfer_pending"),
    CANCELLED("cancelled"),
    UNKNOWN("unknown");

    /** Only a `valid` ticket should present a live, scannable code. */
    val isPresentable: Boolean get() = this == VALID

    val isUsed: Boolean get() = this == CHECKED_IN

    val displayLabel: String
        get() = when (this) {
            VALID -> "Valid"
            CHECKED_IN -> "Checked In"
            REVOKED -> "Revoked"
            EXPIRED -> "Expired"
            TRANSFER_PENDING -> "Transferring"
            CANCELLED -> "Cancelled"
            UNKNOWN -> "Status unavailable"
        }

    companion object {
        /** The DB's raw `scanned` is normalised to `checked_in` upstream, but accept
         *  either — being defensive here is cheaper than a wrong-looking pass. */
        fun from(raw: String?): TicketStatus = when (raw) {
            null -> UNKNOWN
            "scanned" -> CHECKED_IN
            else -> entries.firstOrNull { it.wire == raw } ?: UNKNOWN
        }
    }
}

/**
 * The QR module grid, encoded on the PHONE and shipped over the wire.
 *
 * Neither watch re-encodes: watchOS has no Core Image, and re-encoding on Wear
 * would mean two encoders that can disagree about masking or version. The phone
 * runs `react-native-qrcode-svg`'s matrix generator at error-correction level "H"
 * once, and both wrists paint the same bits — byte-identical codes at the door.
 *
 * Hex, row-major, 4 modules per character, most-significant bit first.
 */
data class WatchQrMatrix(val size: Int, val bits: String) {

    /**
     * Row-major dark/light modules, or `null` if `bits` is malformed or short.
     *
     * Fails CLOSED, exactly like the Swift `modules` property: a half-drawn code
     * still scans, and it scans as the wrong ticket.
     */
    val modules: BooleanArray?
        get() {
            if (size !in 21..177 || (size - 21) % 4 != 0) return null
            val count = size * size
            if (bits.length != (count + 3) / 4 || bits.any { it !in '0'..'9' && it !in 'a'..'f' && it !in 'A'..'F' }) return null
            val out = BooleanArray(count)
            var i = 0
            for (ch in bits) {
                val nibble = Character.digit(ch, 16)
                if (nibble < 0) return null
                var shift = 3
                while (shift >= 0) {
                    if (i >= count) break
                    out[i++] = ((nibble shr shift) and 1) == 1
                    shift--
                }
            }
            return if (i == count) out else null
        }

    companion object {
        fun from(json: JSONObject?): WatchQrMatrix? {
            if (json == null) return null
            val size = json.optInt("size", 0)
            val bits = json.optString("bits", "")
            if (size !in 21..177 || (size - 21) % 4 != 0 || bits.isEmpty()) return null
            return WatchQrMatrix(size, bits)
        }
    }
}

/** Mirrors `WatchTicket` (Swift) / `WatchTicketDTO` (TS). */
data class WatchTicket(
    val id: String,
    val eventId: String,
    val qrToken: String,
    val status: TicketStatus,
    /** Present only for a `valid` ticket — nothing else presents a scannable code
     *  and the replicated DataItem is size-capped. */
    val qrMatrix: WatchQrMatrix?,
    val tier: String?,
    val tierName: String?,
    val tableNumber: String?,
    val checkedInAt: String?,
    // Denormalised event snapshot so the wrist is glanceable AND offline-capable.
    val eventTitle: String,
    val eventDate: String?,      // ISO8601
    val eventEndDate: String?,   // ISO8601
    val eventLocation: String?,
    val entryWindow: String?,
    /**
     * The flyer's colour, `#rrggbb`. Seven bytes, and the ONLY artwork guaranteed
     * to be present with the phone in another room — which is why it, not
     * [imageURL], is what stops a card rendering as three lines of text on black.
     */
    val dominantHex: String?,
    /**
     * A watch-sized rendition of the flyer. Carried for schema parity with the
     * Apple Watch and for a future image-loading pass; NOT rendered today.
     *
     * That is a decision, not an omission. A paired Wear device routinely has no
     * network of its own, this module ships no image loader (no Coil, no disk
     * cache), and nothing fetched would survive into the persisted cache that
     * makes the app work with the phone away. [dominantHex] is the guarantee; art
     * would be the upgrade, and an upgrade that only renders when the wrist
     * happens to be online is worse than none on a surface judged in 2 seconds.
     */
    val imageURL: String?,
    /** `null` when the phone could not resolve identity; `false` means this pass is
     *  held under someone else's account and was bought for the wearer. */
    val isOwner: Boolean?,
) {
    companion object {
        fun from(json: JSONObject): WatchTicket = WatchTicket(
            id = json.optString("id", ""),
            eventId = json.optString("eventId", ""),
            qrToken = json.optString("qrToken", ""),
            status = TicketStatus.from(json.optStringOrNull("status")),
            qrMatrix = WatchQrMatrix.from(json.optJSONObject("qrMatrix")),
            tier = json.optStringOrNull("tier"),
            tierName = json.optStringOrNull("tierName"),
            tableNumber = json.optStringOrNull("tableNumber"),
            checkedInAt = json.optStringOrNull("checkedInAt"),
            eventTitle = json.optStringOrNull("eventTitle") ?: "Event",
            eventDate = json.optStringOrNull("eventDate"),
            eventEndDate = json.optStringOrNull("eventEndDate"),
            eventLocation = json.optStringOrNull("eventLocation"),
            entryWindow = json.optStringOrNull("entryWindow"),
            dominantHex = json.optStringOrNull("dominantHex"),
            imageURL = json.optStringOrNull("imageURL"),
            isOwner = json.opt("isOwner") as? Boolean,
        )
    }
}

/**
 * The member's resolved capabilities, as projected by the phone. Mirrors
 * `WatchMembership` (Swift) / `WatchMembershipDTO` (TS).
 *
 * The watch resolves NOTHING: no plan ranking, no date maths against a period end,
 * no processor SDK. It renders what the phone's resolver already decided, which is
 * how invariant I3 stays true on this side of the wire too.
 */
data class WatchMembership(
    val planLabel: String,
    val memberBadge: Boolean,
    val priorityRsvp: Boolean,
    val earlyTicketAccess: Boolean,
    val vipAdmission: Boolean,
    val expeditedEntry: Boolean,
    val coatCheck: Boolean,
) {
    /**
     * What this plan changes about walking up to a door tonight, in the order a
     * member would use it. Anything that does not change behaviour at a venue
     * (badges, RSVP priority, early access) is deliberately absent — it is
     * phone-side marketing and the wrist is not where it belongs.
     */
    val doorPerks: List<String>
        get() = buildList {
            if (expeditedEntry) add("EXPEDITED ENTRY")
            if (vipAdmission) add("VIP ADMISSION")
            if (coatCheck) add("COAT CHECK INCLUDED")
        }

    companion object {
        fun from(json: JSONObject?): WatchMembership? {
            if (json == null) return null
            return WatchMembership(
                planLabel = json.optStringOrNull("planLabel") ?: return null,
                memberBadge = json.optBoolean("memberBadge"),
                priorityRsvp = json.optBoolean("priorityRsvp"),
                earlyTicketAccess = json.optBoolean("earlyTicketAccess"),
                vipAdmission = json.optBoolean("vipAdmission"),
                expeditedEntry = json.optBoolean("expeditedEntry"),
                coatCheck = json.optBoolean("coatCheck"),
            )
        }
    }
}

/** A run of tickets for one event — the unit of the home list. Mirrors `EventGroup`. */
data class EventGroup(
    val id: String,
    val title: String,
    val dateMillis: Long?,
    val location: String?,
    /** Lifted off the tickets so a row can draw itself without reaching into them. */
    val dominantHex: String?,
    val imageURL: String?,
    val tickets: List<WatchTicket>,
) {
    val count: Int get() = tickets.size
    val hasPresentable: Boolean get() = tickets.any { it.status.isPresentable }
}

/** The whole payload the phone sends, with a sync timestamp for honest staleness. */
data class WatchTicketEnvelope(
    val tickets: List<WatchTicket>,
    /** Epoch SECONDS, stamped by the phone — the watch clock is not trusted for this. */
    val syncedAt: Long,
    /** Absent until the phone's entitlement query resolves. Absent means "we do not
     *  know yet", which the UI renders as nothing — never as Free. */
    val membership: WatchMembership?,
    val protocol: Int? = null,
    val accountGen: String? = null,
) {
    val isEmpty: Boolean get() = tickets.isEmpty()

    companion object {
        val EMPTY = WatchTicketEnvelope(emptyList(), 0L, null)

        /** Lenient parse. Returns null only when the document itself is unreadable —
         *  a bad envelope must leave the persisted cache intact, not blank the wrist. */
        fun parse(json: String?): WatchTicketEnvelope? {
            if (json.isNullOrBlank()) return null
            return try {
                val root = JSONObject(json)
                val arr: JSONArray = root.optJSONArray("tickets") ?: JSONArray()
                val tickets = ArrayList<WatchTicket>(arr.length())
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val ticket = runCatching { WatchTicket.from(obj) }.getOrNull() ?: continue
                    if (ticket.id.isNotEmpty()) tickets.add(ticket)
                }
                WatchTicketEnvelope(
                    tickets = tickets,
                    syncedAt = root.optLong("syncedAt", 0L),
                    membership = WatchMembership.from(root.optJSONObject("membership")),
                    protocol = if (root.has("protocol")) root.optInt("protocol") else null,
                    accountGen = root.optStringOrNull("accountGen"),
                )
            } catch (_: Throwable) {
                null
            }
        }
    }
}

/**
 * Grouping and sort order, ported 1:1 from `TicketStore.swift`. Both wrists must
 * put the same event at the top or "the first row" means two different things.
 */
fun WatchTicketEnvelope.groups(): List<EventGroup> {
    val byEvent = tickets.groupBy { it.eventId }
    val groups = byEvent.map { (eventId, ticketsForEvent) ->
        EventGroup(
            id = eventId,
            title = ticketsForEvent.firstOrNull()?.eventTitle ?: "Event",
            dateMillis = ticketsForEvent.firstNotNullOfOrNull { parseIso8601(it.eventDate) },
            location = ticketsForEvent.firstOrNull()?.eventLocation,
            // Take the first ticket that actually HAS artwork rather than index 0:
            // a group can mix a freshly-issued row (the phone's optimistic RSVP
            // record, which has no event join yet) with a synced one that does.
            // Reading position 0 blindly is how a card that has art renders blank.
            dominantHex = ticketsForEvent.firstNotNullOfOrNull { it.dominantHex },
            imageURL = ticketsForEvent.firstNotNullOfOrNull { it.imageURL },
            // Stable order inside a group: presentable first, then by tier label.
            tickets = ticketsForEvent.sortedWith(
                compareByDescending<WatchTicket> { it.status.isPresentable }
                    .thenBy { it.tierName ?: "" },
            ),
        )
    }
    return groups.sortedWith(
        compareByDescending<EventGroup> { it.hasPresentable }
            // Dateless events sort after dated ones, then alphabetically.
            .thenBy { it.dateMillis ?: Long.MAX_VALUE }
            .thenBy { it.title },
    )
}

/** Next upcoming presentable event — the one fact that must survive into ambient. */
fun WatchTicketEnvelope.nextEvent(): EventGroup? = groups().firstOrNull { it.hasPresentable }

// ------------------------------------------------------------------------ helpers

/** `org.json` turns a missing key into the literal string "null"; this does not. */
internal fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val value = optString(key, "")
    return value.ifBlank { null }
}

/**
 * ISO8601 with and without fractional seconds, matching `TicketStore.parseDate`.
 * Returns epoch millis, or null — a date we cannot read must never crash a row.
 */
internal fun parseIso8601(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { java.time.Instant.parse(iso).toEpochMilli() }
        .recoverCatching {
            java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        }
        .getOrNull()
}
