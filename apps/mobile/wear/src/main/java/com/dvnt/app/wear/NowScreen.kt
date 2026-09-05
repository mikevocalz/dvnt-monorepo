package com.dvnt.app.wear

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.launch

/** Cached, account-scoped launch surface. Selection is stable by event identity. */
@Composable
fun NowScreen(onEvent: (String) -> Unit, onShowTicket: (String) -> Unit, onInbox: () -> Unit, onEvents: () -> Unit) {
    val context = LocalContext.current
    val eventsRepository = remember { EventRepository.get(context) }
    val events by eventsRepository.state.collectAsState()
    val tickets by TicketRepository.get(context).envelope.collectAsState()
    val door by DoorRepository.get(context).state.collectAsState()
    val broadcasts by BroadcastRepository.get(context).state.collectAsState()
    var showBroadcasts by rememberSaveable(events.accountGen) { mutableStateOf(false) }
    if (showBroadcasts) { BroadcastScreen { showBroadcasts = false }; return }
    val scope = rememberCoroutineScope()
    var showDoor by rememberSaveable(events.accountGen) { mutableStateOf(false) }
    if (showDoor) { DoorScreen { showDoor = false }; return }
    val list = rememberTransformingLazyColumnState()
    val pass = tickets.tickets.filter { it.status.isPresentable && (parseIso8601(it.eventEndDate ?: it.eventDate)?.let { stamp -> stamp >= System.currentTimeMillis() } != false) }
        .minByOrNull { parseIso8601(it.eventDate) ?: Long.MAX_VALUE }
    val event = events.events.filter { it.status == "active" && it.section() != "Past" }
        .minByOrNull { parseIso8601(it.startAt) ?: Long.MAX_VALUE }
    LaunchedEffect(events.accountGen) { eventsRepository.refresh() }
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item { Text("DVNT", style = Dvnt.Type.title, color = Dvnt.cyan) }
            item { Text("NOW", style = Dvnt.Type.stamp) }
            if (pass != null) {
                item { Text(pass.eventTitle, style = Dvnt.Type.title) }
                item { EventButton("Show pass") { onShowTicket(pass.eventId) } }
                pass.eventLocation?.let { item { Text(it, style = Dvnt.Type.body) } }
                item { EventButton("Event details") { onEvent(pass.eventId) } }
            } else if (event != null) {
                item { Text(event.title, style = Dvnt.Type.title) }
                item { Text(event.stateLabel, style = Dvnt.Type.caption, color = Dvnt.cyan) }
                item { EventButton(if (event.inviteStatus == "pending") "View invitation" else "View event") { onEvent(event.id) } }
            } else item { Text(if (events.syncedAt == 0L) "Open DVNT on your phone to sync your events and tickets." else "No upcoming event", style = Dvnt.Type.body) }
            if (broadcasts.broadcasts.isNotEmpty()) item { EventButton("Host notices · ${broadcasts.broadcasts.count { !it.read }} unread") { showBroadcasts = true } }
            if (door.door != null) item { EventButton("Host Door") { showDoor = true } }
            events.error?.let { item { Text(it, style = Dvnt.Type.caption, color = Dvnt.signal) } }
            if (events.syncedAt > 0) item { Text("Events updated ${java.time.Instant.ofEpochSecond(events.syncedAt)}", style = Dvnt.Type.caption, color = Dvnt.textDim) }
            item { EventButton("Refresh") { scope.launch { eventsRepository.refresh() } } }
            item { EventButton("Inbox", onInbox) }
            item { EventButton("Events", onEvents) }
        }
    }
}
