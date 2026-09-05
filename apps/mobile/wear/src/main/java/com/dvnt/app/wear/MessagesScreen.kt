package com.dvnt.app.wear

import android.app.Activity
import android.app.RemoteInput
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.focusable
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.input.RemoteInputIntentHelper
import com.dvnt.app.wear.ui.MessageImage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun MessagesScreen(onTickets: () -> Unit, onEvents: () -> Unit, onCalls: () -> Unit) {
    val context = LocalContext.current
    val repo = remember { MessageRepository.get(context) }
    val inbox by repo.inbox.collectAsState()
    var selected by rememberSaveable(inbox.accountGen) { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("All") }
    val state = rememberTransformingLazyColumnState()
    val threadStates = key(inbox.accountGen) { androidx.compose.runtime.saveable.rememberSaveableStateHolder() }
    val selectedRow = inbox.conversations.firstOrNull { it.id == selected }
    LaunchedEffect(inbox.accountGen, selectedRow?.id) { if (selected != null && selectedRow == null) selected = null }
    if (selected != null && selectedRow != null) {
        threadStates.SaveableStateProvider("${inbox.accountGen}:$selected") {
            ConversationScreen(selected!!, selectedRow?.name ?: "Conversation", repo, onBack = { selected = null })
        }
        return
    }
    val scope = rememberCoroutineScope()
    ScreenScaffold(scrollState = state) { padding ->
        TransformingLazyColumn(state = state, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item {
                Column(Modifier.fillMaxWidth().padding(Dvnt.Space.base)) {
                    Text("DVNT", style = Dvnt.Type.title, color = Dvnt.cyan)
                    Text("INBOX", style = Dvnt.Type.stamp)
                    Text(if (inbox.syncedAt > 0) "Updated ${shortTime(inbox.syncedAt)}" else "Waiting for phone", style = Dvnt.Type.caption, color = Dvnt.textDim)
                }
            }
            item {
                ActionRow("$filter · Filter") { filter = when (filter) { "All" -> "Unread"; "Unread" -> "Requests"; else -> "All" } }
            }
            inbox.error?.let { error -> item { Text(error, style = Dvnt.Type.body, color = Dvnt.signal) } }
            if (!inbox.signedIn) item { Text("Open DVNT and sign in on your phone.", style = Dvnt.Type.body) }
            val rows = inbox.conversations.filter { if (filter == "Requests") it.category == "request" else it.category == "inbox" && (filter != "Unread" || it.unread) }
            if (inbox.signedIn && inbox.error == null && rows.isEmpty()) item { Text(if (filter == "Requests") "No requests" else if (filter == "Unread") "All caught up" else "No messages yet", style = Dvnt.Type.body) }
            items(rows, key = { it.id }) { row ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Dvnt.Radius.card)).background(Dvnt.Surface.mid)
                    .clickable(role = Role.Button) { selected = row.id }.padding(Dvnt.Space.base)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Dvnt.Space.base)) {
                        if (row.avatarURL != null) MessageImage(row.avatarURL, inbox.accountGen, "${row.name} avatar", Modifier.size(36.dp).clip(RoundedCornerShape(Dvnt.Radius.chip)))
                        Text((if (row.unread) "● " else "") + row.name, style = Dvnt.Type.body,
                            fontWeight = if (row.unread) FontWeight.Bold else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text(row.preview, style = Dvnt.Type.caption, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Dvnt.textDim)
                    if (row.attachments.isNotEmpty()) {
                        val media = row.attachments.first()
                        Text(if (media.kind == "video") "Video · On phone" else "${row.attachments.size} photo${if (row.attachments.size == 1) "" else "s"}", style = Dvnt.Type.caption)
                        MessageImage(media.thumbURL, inbox.accountGen, media.alt ?: "Message photo", Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(Dvnt.Radius.chip)))
                    }
                    Text(shortTime(row.timestamp), style = Dvnt.Type.caption, color = Dvnt.textDim)
                }
            }
            item { ActionRow("Refresh") { scope.launch { PhoneLink.requestSync(context); repo.hydrate() } } }
            item { ActionRow("Events", onClick = onEvents) }
            item { ActionRow("Calls", onClick = onCalls) }
            item { ActionRow("Tickets", onClick = onTickets) }
        }
    }
}

@Composable
private fun ConversationScreen(id: String, name: String, repo: MessageRepository, onBack: () -> Unit) {
    val inbox by repo.inbox.collectAsState()
    val threads by repo.threads.collectAsState()
    val outbox by repo.outbox.collectAsState()
    val pendingReactions by repo.reactions.collectAsState()
    val thread = threads[id] ?: ThreadState()
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable(id, inbox.accountGen) { mutableStateOf(repo.draft(id)) }
    var composeError by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var reactionMessage by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var reactionError by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var reacting by remember(id) { mutableStateOf(false) }
    var viewerMessage by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var viewerIndex by rememberSaveable(id) { mutableIntStateOf(0) }
    val state = rememberTransformingLazyColumnState()
    val viewer = thread.messages.firstOrNull { it.id == viewerMessage }
    if (viewer != null) {
        MediaViewer(viewer.attachments, viewerIndex, inbox.accountGen, { viewerIndex = it }, { viewerMessage = null })
        return
    }
    val reactingTo = thread.messages.firstOrNull { it.id == reactionMessage }
    if (reactingTo != null) {
        BackHandler { if (!reacting) reactionMessage = null }
        val reactionsState = rememberTransformingLazyColumnState()
        ScreenScaffold(scrollState = reactionsState) { padding ->
            TransformingLazyColumn(state = reactionsState, contentPadding = padding, modifier = Modifier.fillMaxSize()) {
                item { Text("React", style = Dvnt.Type.title) }
                items(listOf("😂", "😢", "😊", "😈", "🥵", "💝", "❤️")) { emoji ->
                    val mine = reactingTo.reactions.any { it.emoji == emoji && it.mine }
                    ActionRow("$emoji ${if (mine) "Remove" else "Add"}${if (reacting) " · Updating…" else ""}") {
                        if (!reacting) {
                            reacting = true
                            scope.launch {
                                reactionError = repo.react(id, reactingTo.id, emoji, !mine)
                                reacting = false
                                if (reactionError == null) reactionMessage = null
                            }
                        }
                    }
                }
                reactionError?.let { error -> item { Text(error, style = Dvnt.Type.caption, color = Dvnt.signal) } }
                if (!reacting) item { ActionRow("Back") { reactionMessage = null } }
            }
        }
        return
    }
    BackHandler(onBack = onBack)
    val input = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) result.data?.let { intent ->
            RemoteInput.getResultsFromIntent(intent)?.getCharSequence("reply")?.toString()?.let { value ->
                draft = value.take(500); repo.setDraft(id, draft)
            }
        }
    }
    fun compose() {
        try {
            val remote = RemoteInput.Builder("reply").setLabel("Reply to $name").setAllowFreeFormInput(true)
                .setChoices(inbox.quickReplies.toTypedArray()).build()
            input.launch(RemoteInputIntentHelper.createActionRemoteInputIntent().also {
                RemoteInputIntentHelper.putRemoteInputsExtra(it, listOf(remote))
            })
        } catch (_: Exception) { composeError = "Input unavailable. Open this conversation on your phone." }
    }
    LaunchedEffect(id, inbox.accountGen, inbox.syncedAt) { repo.loadThread(id) }
    ScreenScaffold(scrollState = state) { padding ->
        TransformingLazyColumn(state = state, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item { Text(name, style = Dvnt.Type.title) }
            if (thread.olderCursor != null) item { ActionRow("Earlier messages") { scope.launch { repo.loadThread(id, older = true) } } }
            if (thread.loading) item { Text("Loading…", style = Dvnt.Type.caption) }
            thread.error?.let { error -> item { ActionRow(error + " · Retry") { scope.launch { repo.loadThread(id) } } } }
            if (!thread.loading && thread.error == null && thread.messages.isEmpty()) item { Text("Start the conversation", style = Dvnt.Type.body) }
            items(thread.messages, key = { it.id }) { message ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Dvnt.Radius.card))
                    .background(if (message.outgoing) Dvnt.violet.copy(alpha = 0.25f) else Dvnt.Surface.mid).padding(Dvnt.Space.base)) {
                    Text(if (message.outgoing) "YOU" else message.senderName ?: name, style = Dvnt.Type.stamp, color = Dvnt.textDim)
                    if (message.text.isNotBlank()) Text(message.text, style = Dvnt.Type.body)
                    message.attachments.forEachIndexed { index, media ->
                        if (media.kind == "video") Text("Video · Watch on phone", style = Dvnt.Type.caption)
                        MessageImage(media.thumbURL, inbox.accountGen, media.alt ?: "Photo ${index + 1} of ${message.attachments.size}",
                            Modifier.fillMaxWidth().height(100.dp).clip(RoundedCornerShape(Dvnt.Radius.chip))
                                .clickable(role = Role.Button) { viewerMessage = message.id; viewerIndex = index })
                    }
                    if (message.reactions.isNotEmpty()) Text(message.reactions.joinToString("  ") { "${it.emoji} ${it.count}${if (it.mine) " · You" else ""}" }, style = Dvnt.Type.caption)
                    ActionRow("React") { reactionMessage = message.id; reactionError = null }
                    Text(shortTime((parseIso8601(message.createdAt) ?: 0) / 1000), style = Dvnt.Type.caption, color = Dvnt.textDim)
                }
            }
            items(outbox.filter { it.conversationId == id && (it.status != "sent" || thread.messages.none { row -> row.id == it.serverId }) }, key = { "outbox:${it.operationId}" }) { entry ->
                Column(Modifier.fillMaxWidth().padding(Dvnt.Space.base)) {
                    Text(entry.text, style = Dvnt.Type.body)
                    Text(entry.status.replaceFirstChar { it.uppercase() }, style = Dvnt.Type.caption, color = if (entry.status == "failed") Dvnt.signal else Dvnt.textDim)
                    entry.error?.let { Text(it, style = Dvnt.Type.caption) }
                    if (entry.status == "failed" || entry.status == "queued") ActionRow("Retry") { scope.launch { repo.send(entry.operationId) } }
                    if (entry.status == "queued") ActionRow("Cancel") { repo.cancel(entry.operationId) }
                }
            }
            items(pendingReactions.filter { it.conversationId == id }, key = { "reaction:${it.key}" }) { intent ->
                Column {
                    Text("${intent.emoji} ${if (intent.desiredPresent) "Add" else "Remove"} · Not confirmed", style = Dvnt.Type.caption)
                    ActionRow("Retry reaction") { scope.launch { reactionError = repo.retryReaction(intent.key) } }
                    ActionRow("Cancel pending reaction") { repo.cancelReaction(intent.key) }
                }
            }
            reactionError?.let { error -> item { Text(error, style = Dvnt.Type.caption, color = Dvnt.signal) } }
            item { ActionRow("Refresh messages") { scope.launch { repo.loadThread(id) } } }
            item { ActionRow(if (draft.isBlank()) "Reply" else "Edit reply") { compose() } }
            if (draft.isNotBlank()) {
                item { Text(draft, style = Dvnt.Type.body) }
                item { ActionRow("Send") {
                    val operation = repo.queue(id, draft)
                    if (operation != null) { draft = ""; scope.launch { repo.send(operation) } }
                    else composeError = "Could not queue reply. Check your account and retry."
                } }
                item { ActionRow("Discard draft") { draft = ""; repo.setDraft(id, "") } }
            }
            composeError?.let { error -> item { Text(error, style = Dvnt.Type.caption, color = Dvnt.signal) } }
            item { ActionRow("Back", onClick = onBack) }
        }
    }
}

@Composable
private fun MediaViewer(items: List<MessageAttachment>, index: Int, account: String, onIndex: (Int) -> Unit, onBack: () -> Unit) {
    val media = items.getOrNull(index) ?: return
    var zoom by remember(index) { mutableFloatStateOf(1f) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(index) { focus.requestFocus() }
    BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().padding(Dvnt.Space.arc), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("${index + 1} of ${items.size}", style = Dvnt.Type.caption)
        MessageImage(media.fullURL ?: media.thumbURL, account, media.alt ?: "Photo ${index + 1}",
            Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(Dvnt.Radius.card))
                .focusRequester(focus).onRotaryScrollEvent { zoom = (zoom + it.verticalScrollPixels / 300f).coerceIn(1f, 3f); true }.focusable()
                .graphicsLayer(scaleX = zoom, scaleY = zoom), ContentScale.Fit)
        Row {
            if (index > 0) ActionRow("Previous", modifier = Modifier.weight(1f)) { onIndex(index - 1) }
            if (index < items.lastIndex) ActionRow("Next", modifier = Modifier.weight(1f)) { onIndex(index + 1) }
        }
        ActionRow("Back", onClick = onBack)
    }
}

@Composable
private fun ActionRow(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.fillMaxWidth().heightIn(min = Dvnt.Size.minTouch).clip(RoundedCornerShape(Dvnt.Radius.chip))
        .background(Dvnt.Surface.mid).clickable(role = Role.Button, onClick = onClick).padding(Dvnt.Space.base), contentAlignment = Alignment.Center) {
        Text(label, style = Dvnt.Type.body, color = Dvnt.cyan)
    }
}
private fun shortTime(seconds: Long): String = if (seconds <= 0) "" else runCatching {
    DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochSecond(seconds))
}.getOrDefault("")
