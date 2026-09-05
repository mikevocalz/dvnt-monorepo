package com.dvnt.app.wear

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.dvnt.app.wear.ui.MessageImage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun EventsScreen(onInbox: () -> Unit, onTickets: () -> Unit, initialEventId: String? = null, launchToken: Long? = null) {
    val context = LocalContext.current
    val repository = remember { EventRepository.get(context) }
    val state by repository.state.collectAsState()
    val scope = rememberCoroutineScope()
    var selected by rememberSaveable(state.accountGen) { mutableStateOf<String?>(null) }
    val list = rememberTransformingLazyColumnState()
    val saved = key(state.accountGen) { rememberSaveableStateHolder() }
    LaunchedEffect(state.accountGen) { repository.refresh() }
    LaunchedEffect(launchToken) { if (initialEventId != null) selected = initialEventId }
    val event = state.events.firstOrNull { it.id == selected }
    if (selected != null) {
        BackHandler { selected = null }
        if (event == null) {
            Column(Modifier.fillMaxSize().padding(Dvnt.Space.arc), verticalArrangement = Arrangement.Center) {
                Text(if (state.loading) "Loading event…" else "This event is no longer available", style = Dvnt.Type.body)
                EventButton("Back") { selected = null }
            }
        } else saved.SaveableStateProvider(event.id) { EventDetail(event, state, repository, { selected = null }, onTickets) }
        return
    }
    BackHandler(onBack = onInbox)
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item {
                Column(Modifier.fillMaxWidth().padding(Dvnt.Space.base)) {
                    Text("DVNT", style = Dvnt.Type.title, color = Dvnt.cyan)
                    Text("EVENTS", style = Dvnt.Type.stamp)
                    if (state.syncedAt > 0) Text("Updated ${eventTime(state.syncedAt * 1000, null, false)}", style = Dvnt.Type.caption, color = Dvnt.textDim)
                }
            }
            if (state.loading) item { Text("Refreshing…", style = Dvnt.Type.caption) }
            state.error?.let { error -> item { EventButton("$error · Retry") { scope.launch { repository.refresh() } } } }
            if (state.events.isEmpty() && !state.loading && state.error == null) item { Text("No events yet. Invitations, saved events and RSVPs appear here.", style = Dvnt.Type.body) }
            for (section in listOf("Tonight", "Invitations", "Going", "Interested", "Waitlist", "Saved", "Hosting", "Past")) {
                val rows = state.events.filter { it.section() == section }
                if (rows.isNotEmpty()) {
                    item { Text(section, style = Dvnt.Type.stamp, color = Dvnt.textDim) }
                    items(rows, key = { it.id }) { row ->
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Dvnt.Radius.card)).background(Dvnt.Surface.mid)
                            .clickable(role = Role.Button) { selected = row.id }.padding(Dvnt.Space.base)) {
                            row.imageURL?.let { MessageImage(it, state.accountGen, "${row.title} flyer", Modifier.fillMaxWidth().height(76.dp).clip(RoundedCornerShape(Dvnt.Radius.chip))) }
                            Text(row.title, style = Dvnt.Type.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(eventTime(parseIso8601(row.startAt), row.timeZone), style = Dvnt.Type.caption, color = Dvnt.textDim)
                            Text(row.stateLabel, style = Dvnt.Type.caption, color = if (row.status in listOf("cancelled", "postponed")) Dvnt.signal else Dvnt.cyan)
                        }
                    }
                }
            }
            item { EventButton("Refresh") { scope.launch { repository.refresh() } } }
            item { EventButton("Inbox", onClick = onInbox) }
            item { EventButton("Tickets", onClick = onTickets) }
        }
    }
}

@Composable
private fun EventDetail(event: WatchEvent, state: EventsState, repository: EventRepository, onBack: () -> Unit, onTickets: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val list = rememberTransformingLazyColumnState()
    val pending = event.id in state.pending
    val result = state.results[event.id]
    var directionsError by rememberSaveable(event.id) { mutableStateOf<String?>(null) }
    fun perform(action: String, ticketTypeId: String? = null) { if (!pending) scope.launch { repository.perform(event.id, action, ticketTypeId) } }
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            event.imageURL?.let { url -> item { MessageImage(url, state.accountGen, "${event.title} flyer", Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(Dvnt.Radius.card))) } }
            item { Text(event.title, style = Dvnt.Type.title) }
            item { Text(event.stateLabel, style = Dvnt.Type.stamp, color = if (event.status in listOf("cancelled", "postponed")) Dvnt.signal else Dvnt.cyan) }
            item { Text(eventTime(parseIso8601(event.startAt), event.timeZone), style = Dvnt.Type.body) }
            if (event.timeZone != null && event.timeZone != ZoneId.systemDefault().id) item { Text("Your time · ${eventTime(parseIso8601(event.startAt), null)}", style = Dvnt.Type.caption, color = Dvnt.textDim) }
            item { Text(if (event.isOnline) "Online event" else event.location ?: "Location unavailable", style = Dvnt.Type.body) }
            event.weather?.let { weather -> item {
                Column {
                    Text("Venue weather · ${kotlin.math.round(weather.tempF).toInt()}°F" + (weather.label?.let { " · $it" } ?: ""), style = Dvnt.Type.body)
                    Text("Updated ${eventTime(parseIso8601(weather.generatedAt), event.timeZone)}", style = Dvnt.Type.caption, color = Dvnt.textDim)
                    weather.precipPct?.let { Text("Precipitation ${it.toInt()}%", style = Dvnt.Type.caption, color = Dvnt.textDim) }
                }
            } }
            if (pending) item { Text("Confirming on phone…", style = Dvnt.Type.body) }
            result?.let { item { Text(it.message, style = Dvnt.Type.body, color = if (it.status == "confirmed") Dvnt.cyan else Dvnt.signal) } }
            if (!pending && result?.status != "failed" && event.status == "active" && (parseIso8601(event.endAt)?.let { it > System.currentTimeMillis() } != false)) {
                if (event.inviteStatus == "pending") item { EventButton("Open invitation on phone") { perform("open_on_phone") } }
                else {
                    if (!event.ticketingEnabled) item { EventButton(if (event.rsvp == "going") "Going · Change on phone" else "RSVP Going") { perform(if (event.rsvp == "going") "open_on_phone" else "going") } }
                    else item { EventButton("Continue on phone") { perform("open_on_phone") } }
                    item { EventButton(if (event.rsvp == "interested") "Interested ✓" else "Interested") { perform("interested") } }
                    item { EventButton("Can't go") { perform("not_going") } }
                }
                if (event.canJoinWaitlist && event.waitlist.isEmpty()) item { EventButton("Join waitlist") { perform("waitlist_join") } }
                items(event.waitlist) { entry ->
                    Column {
                        Text("Waitlist · ${entry.offerStatus}", style = Dvnt.Type.caption)
                        entry.offerExpiresAt?.let { Text("Offer expires ${eventTime(parseIso8601(it), event.timeZone)}", style = Dvnt.Type.caption) }
                        if (entry.offerStatus == "offered") EventButton("Claim offer on phone") { perform("open_on_phone") }
                        EventButton("Leave waitlist") { perform("waitlist_leave", entry.ticketTypeId) }
                    }
                }
            }
            if (!pending) item { EventButton("Open event on phone") { perform("open_on_phone") } }
            val lat = event.latitude
            val lng = event.longitude
            if (!event.isOnline && lat != null && lng != null && lat in -90.0..90.0 && lng in -180.0..180.0) item {
                EventButton("Directions") {
                    try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    catch (_: Exception) { directionsError = "Maps unavailable. Open this event on your phone." }
                }
            }
            directionsError?.let { error -> item { Text(error, style = Dvnt.Type.caption) } }
            item { EventButton("Tickets", onClick = onTickets) }
            item { EventButton("Back", onClick = onBack) }
        }
    }
}
@Composable
private fun EventButton(label: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = Dvnt.Size.minTouch).clip(RoundedCornerShape(Dvnt.Radius.chip))
        .background(Dvnt.Surface.mid).clickable(role = Role.Button, onClick = onClick).padding(Dvnt.Space.base), contentAlignment = Alignment.Center) {
        Text(label, style = Dvnt.Type.body, color = Dvnt.cyan)
    }
}
private fun eventTime(millis: Long?, zoneId: String?, includeDate: Boolean = true): String {
    if (millis == null) return "Time unavailable"
    val zone = runCatching { ZoneId.of(zoneId) }.getOrDefault(ZoneId.systemDefault())
    return DateTimeFormatter.ofPattern(if (includeDate) "EEE d MMM · HH:mm z" else "HH:mm").withZone(zone).format(Instant.ofEpochMilli(millis))
}
