package com.dvnt.app.wear

import org.junit.Assert.*
import org.junit.Test

class WatchCallTest {
    @Test fun expiredIncomingAndFutureClockSkewNeverBecomeAnswerable() {
        val incoming = IncomingCompanionCall("12", "Caller", true, false, 100)
        assertTrue(incoming.isFresh(100))
        assertTrue(incoming.isFresh(129))
        assertFalse(incoming.isFresh(130))
        assertFalse(incoming.isFresh(94))
    }
    @Test fun processDeathRecoveryIsBoundToOriginalAccountCallAndDeadline() {
        val incoming = IncomingCompanionCall("12", "Phone call", false, false, 100)
        val empty = CallsState()
        assertTrue(canRecoverNotificationAction(empty, incoming, "12", "a", "a", emptySet(), 110))
        assertFalse(canRecoverNotificationAction(empty, incoming, "12", "a", "b", emptySet(), 110))
        assertFalse(canRecoverNotificationAction(empty, incoming, "13", "a", "a", emptySet(), 110))
        assertFalse(canRecoverNotificationAction(empty, incoming, "12", "a", "a", setOf("12"), 110))
        assertFalse(canRecoverNotificationAction(empty, incoming, "12", "a", "a", emptySet(), 130))
        val connected = empty.copy(active = ActiveCompanionCall("room", "connected", "connected", "Phone call", false, true, 150, 100.0))
        assertFalse(canRecoverNotificationAction(connected, incoming, "12", "a", "a", emptySet(), 110))
    }
    @Test fun activeStateRequiresFreshHeartbeatAndNeverLabelsEndedAsLive() {
        val live = ActiveCompanionCall("room", "connected", "connected", "Caller", false, true, 150, 100.0)
        assertTrue(live.isFresh(149))
        assertFalse(live.isFresh(150))
        assertFalse(live.copy(phase = "ended").isFresh(100))
        assertTrue(live.copy(phase = "reconnecting").isFresh(100))
    }
}
