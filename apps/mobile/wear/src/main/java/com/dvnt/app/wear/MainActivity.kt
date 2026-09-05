package com.dvnt.app.wear

import android.os.Bundle
import androidx.wear.ambient.AmbientLifecycleObserver
import androidx.compose.foundation.layout.offset
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
import com.dvnt.app.wear.ui.QrMatrixView
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole Wear UI. Two screens, because two is what a wrist supports: the
 * list of what you hold, and the pass you present at a door.
 *
 * There is no navigation library here on purpose. One nullable `selected`
 * value is the entire graph, and the hardware back button is wired straight to
 * clearing it — a NavHost would be more code to express the same two states.
 */
data class WearLaunch(val destination: String, val accountGen: String, val eventId: String?, val token: Long = System.nanoTime())

class MainActivity : ComponentActivity() {
    private var launchTarget by mutableStateOf<WearLaunch?>(null)
    private fun readLaunch(intent: android.content.Intent?): WearLaunch? {
        val destination = intent?.getStringExtra("destination") ?: return null
        if (destination !in listOf("Inbox", "Events", "Tickets", "Calls")) return null
        return WearLaunch(destination, intent.getStringExtra("accountGen") ?: "", intent.getStringExtra("eventId")?.takeIf { it.isNotBlank() })
    }
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        launchTarget = readLaunch(intent)
    }
    private var ambient by mutableStateOf(false)
    private var ambientTick by mutableStateOf(0)
    private val ambientObserver by lazy {
        AmbientLifecycleObserver(this, object : AmbientLifecycleObserver.AmbientLifecycleCallback {
            override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) { ambient = true }
            override fun onExitAmbient() { ambient = false }
            override fun onUpdateAmbient() { ambientTick++ }
        })
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launchTarget = readLaunch(intent)
        lifecycle.addObserver(ambientObserver)
        setContent {
            DvntWearTheme {
                val saved = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
                if (ambient) Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    Text("DVNT", style = Dvnt.Type.stamp, color = Dvnt.textDim,
                        modifier = Modifier.offset(((ambientTick % 5) - 2).dp, (((ambientTick / 5) % 5) - 2).dp))
                } else saved.SaveableStateProvider("watch") { WearApp(launchTarget) }
            }
        }

        // Ask the phone to resend on cold start. Fire-and-forget: if the phone
        // is unreachable this fails, and the cached envelope is already on
        // screen, which is the entire reason the cache exists. Scoped to the
        // lifecycle so a rotation or an early finish cancels the node lookup
        // instead of leaking it.
        lifecycleScope.launch {
            TicketRepository.get(applicationContext).hydrateFromDataLayer()
            MessageRepository.get(applicationContext).hydrate()
            PhoneLink.requestSync(applicationContext)
        }
    }
}

@Composable
private fun WearApp(launchTarget: WearLaunch?) {
    val context = LocalContext.current
    val repo = remember { TicketRepository.get(context) }
    val envelope by repo.envelope.collectAsState()
    val everSynced by repo.everSynced.collectAsState()

    var selectedEventId by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
    var destination by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("Inbox") }
    androidx.compose.runtime.LaunchedEffect(launchTarget) {
        launchTarget?.let { target ->
            if (target.accountGen == WearAccountSession.generation(context)) {
                destination = target.destination
                selectedEventId = if (target.destination == "Tickets") target.eventId else null
            } else { destination = "Inbox"; selectedEventId = null }
        }
    }
    val groups = remember(envelope) { envelope.groups() }
    val selected = groups.firstOrNull { it.id == selectedEventId }
    val callState by CallRepository.get(context).state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(callState.incoming?.id) {
        if (callState.incoming?.isFresh() == true) destination = "Calls"
    }
    val messageState by MessageRepository.get(context).inbox.collectAsState()
    val pages = androidx.compose.runtime.key(messageState.accountGen) { androidx.compose.runtime.saveable.rememberSaveableStateHolder() }

    AppScaffold(
        timeText = { TimeText() },
        modifier = Modifier
            .fillMaxSize()
            .background(Dvnt.canvas),
    ) {
        if (destination == "Inbox") {
            pages.SaveableStateProvider("inbox") { MessagesScreen(onTickets = { destination = "Tickets" }, onEvents = { destination = "Events" }, onCalls = { destination = "Calls" }) }
        } else if (destination == "Calls") {
            pages.SaveableStateProvider("calls") { CallsScreen(onInbox = { destination = "Inbox" }) }
        } else if (destination == "Events") {
            pages.SaveableStateProvider("events") { EventsScreen(onInbox = { destination = "Inbox" }, onTickets = { destination = "Tickets" }, initialEventId = launchTarget?.takeIf { it.accountGen == WearAccountSession.generation(context) && it.destination == "Events" }?.eventId, launchToken = launchTarget?.token) }
        } else if (selected != null) {
            TicketScreen(group = selected, onBack = { selectedEventId = null })
        } else {
            androidx.activity.compose.BackHandler { destination = "Inbox" }
            EventListScreen(
                groups = groups,
                everSynced = everSynced,
                onOpen = { selectedEventId = it.id },
            )
        }
    }
}

// --------------------------------------------------------------------- list

@Composable
private fun EventListScreen(
    groups: List<EventGroup>,
    everSynced: Boolean,
    onOpen: (EventGroup) -> Unit,
) {
    if (groups.isEmpty()) {
        EmptyState(everSynced = everSynced)
        return
    }

    val state = rememberScalingLazyListState()
    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        // WR-RD-01/02: a round display eats the corners of a full-width row.
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            horizontal = Dvnt.Space.arc,
            vertical = Dvnt.Space.loose,
        ),
        verticalArrangement = Arrangement.spacedBy(Dvnt.Space.base),
    ) {
        items(groups, key = { it.id }) { group ->
            EventRow(group = group, onClick = { onOpen(group) })
        }
    }
}

@Composable
private fun EventRow(group: EventGroup, onClick: () -> Unit) {
    // The event's own colour, so a card is never a blank slab. Same field the
    // Apple Watch uses, and the same reason: it is the one piece of artwork
    // that is guaranteed present with no network.
    val fill = parseHexColor(group.dominantHex) ?: Dvnt.Surface.mid
    val stroke = if (group.hasPresentable) Dvnt.accent.copy(alpha = 0.55f) else Dvnt.Surface.hairline

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dvnt.Radius.card))
            .background(fill)
            .border(1.dp, stroke, RoundedCornerShape(Dvnt.Radius.card))
            .clickable(onClick = onClick)
            .padding(Dvnt.Space.roomy),
        verticalArrangement = Arrangement.spacedBy(Dvnt.Space.hair),
    ) {
        Text(
            text = group.title,
            style = Dvnt.Type.title,
            color = Color.White,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        group.dateMillis?.let {
            Text(text = formatWhen(it), style = Dvnt.Type.caption, color = Dvnt.textDim)
        }
        group.location?.takeIf { it.isNotBlank() }?.let {
            Text(
                text = it,
                style = Dvnt.Type.caption,
                color = Dvnt.textFaint,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ------------------------------------------------------------------- ticket

@Composable
private fun TicketScreen(group: EventGroup, onBack: () -> Unit) {
    androidx.activity.compose.BackHandler(onBack = onBack)

    // Only a valid ticket presents a scannable code. Everything else shows its
    // status instead — rendering a code for a dead pass is the one failure
    // that strands a member at a door.
    var passIndex by androidx.compose.runtime.saveable.rememberSaveable(group.id) { mutableStateOf(0) }
    val ticket = group.tickets.getOrNull(passIndex) ?: group.tickets.firstOrNull()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = Dvnt.Space.loose),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = group.title,
            style = Dvnt.Type.caption,
            color = Dvnt.textDim,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Dvnt.Space.base))

        if (group.tickets.size > 1) {
            Text("${passIndex + 1} of ${group.tickets.size} · Next pass", style = Dvnt.Type.caption,
                modifier = Modifier.clickable { passIndex = (passIndex + 1) % group.tickets.size }.padding(Dvnt.Space.base))
        }
        val matrix = ticket?.qrMatrix
        if (ticket != null && ticket.status.isPresentable && matrix != null) {
            QrMatrixView(matrix = matrix, size = 132.dp)
            Spacer(Modifier.height(Dvnt.Space.base))
            ticket.tierName?.let {
                Text(
                    text = it.uppercase(Locale.getDefault()),
                    style = Dvnt.Type.stamp,
                    color = Dvnt.tierAccent(ticket.tier),
                )
            }
        } else if (ticket != null) {
            BlockedPass(ticket)
        } else {
            Text(
                text = "No pass on this event",
                style = Dvnt.Type.body,
                color = Dvnt.textDim,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun BlockedPass(ticket: WatchTicket) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dvnt.Radius.card))
            .background(Dvnt.Surface.mid)
            .border(1.dp, Dvnt.statusAccent(ticket.status), RoundedCornerShape(Dvnt.Radius.card))
            .padding(Dvnt.Space.roomy),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = ticket.status.displayLabel.uppercase(Locale.getDefault()),
            style = Dvnt.Type.stamp,
            color = Dvnt.statusAccent(ticket.status),
            textAlign = TextAlign.Center,
        )
    }
}

// -------------------------------------------------------------------- empty

@Composable
private fun EmptyState(everSynced: Boolean) {
    val context = LocalContext.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Dvnt.Space.loose),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // "Never paired" and "paired, no tickets" are completely different
        // problems and must not share a message.
        Text(
            text = if (everSynced) "No tickets yet" else "Open DVNT on your phone",
            style = Dvnt.Type.title,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Dvnt.Space.base))
        Text(
            text = if (everSynced) "Buy on your phone — they appear here."
                   else "Your tickets sync from the phone app.",
            style = Dvnt.Type.body,
            color = Dvnt.textDim,
            textAlign = TextAlign.Center,
            modifier = Modifier.clickable { PhoneLink.openTicketsOnPhone(context) },
        )
    }
}

// ------------------------------------------------------------------ helpers

private val whenFormat = SimpleDateFormat("EEE d MMM · HH:mm", Locale.getDefault())

private fun formatWhen(millis: Long): String = whenFormat.format(Date(millis))

/** `#rrggbb` / `rrggbb` / `#rgb` → Color, else null so the caller falls back to
 *  its own surface rather than painting black-on-black. */
internal fun parseHexColor(raw: String?): Color? {
    var s = raw?.trim()?.lowercase(Locale.ROOT)?.removePrefix("#") ?: return null
    if (s.length == 3) s = s.map { "$it$it" }.joinToString("")
    if (s.length != 6) return null
    val v = s.toLongOrNull(16) ?: return null
    return Color(0xFF000000L or v)
}
