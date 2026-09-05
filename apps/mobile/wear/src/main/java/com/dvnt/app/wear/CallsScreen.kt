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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.input.RemoteInputIntentHelper
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun CallsScreen(onInbox: () -> Unit) {
    val context = LocalContext.current
    val repo = remember { CallRepository.get(context) }
    val state by repo.state.collectAsState()
    val scope = rememberCoroutineScope()
    val list = rememberTransformingLazyColumnState()
    var selected by rememberSaveable(state.accountGen) { mutableStateOf(arrayListOf<String>()) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis() / 1000) }
    var searchError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis() / 1000; delay(1000) } }
    LaunchedEffect(state.accountGen) { repo.refresh() }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) searchError = "Call alerts are disabled. Enable notifications in watch settings."
        CallNotifications.update(context, repo.state.value)
    }
    val search = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) result.data?.let {
            RemoteInput.getResultsFromIntent(it)?.getCharSequence("person")?.toString()?.trim()?.take(60)?.takeIf { value -> value.isNotBlank() }?.let { query ->
                scope.launch { repo.command("callDirectoryAction", "search", query = query) }
            }
        }
    }
    fun action(type: String, action: String, ids: List<String> = emptyList(), video: Boolean = false) {
        scope.launch { repo.command(type, action, ids, video) }
    }
    BackHandler(onBack = onInbox)
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item { Text("CALLS", style = Dvnt.Type.title, color = Dvnt.cyan) }
            if (!CallNotifications.allowed(context)) item { CallButton("Enable call alerts") {
                if (android.os.Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                else context.startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName))
            } }
            item { Text("Audio and video stay on your phone", style = Dvnt.Type.caption, color = Dvnt.textDim) }
            val incoming = state.incoming?.takeIf { it.isFresh(now) }
            if (incoming != null) {
                item { Text(incoming.name, style = Dvnt.Type.title) }
                item { Text(if (incoming.video) "Incoming video call" else "Incoming audio call", style = Dvnt.Type.body) }
                if (!state.pending) {
                    item { CallButton("Answer on phone") { action("callAction", "accept") } }
                    if (incoming.video) item { CallButton("Answer audio on phone") { action("callAction", "accept_audio_only") } }
                    item { CallButton("Decline") { action("callAction", "decline") } }
                }
            }
            state.active?.let { active ->
                item { Text(active.name, style = Dvnt.Type.title) }
                item { Text(if (active.isFresh(now)) active.phase.replaceFirstChar { it.uppercase() } else if (active.phase == "ended") "Call ended" else "Connection status unavailable", style = Dvnt.Type.body) }
                item { Text(active.peerStatus, style = Dvnt.Type.caption) }
                if (active.isFresh(now) && !state.pending) {
                    if (active.canMute) item { CallButton(if (active.muted) "Unmute phone" else "Mute phone") { action("activeCallAction", "set_muted") } }
                    item { CallButton("End call") { action("activeCallAction", "end") } }
                }
            }
            if (state.pending) item { Text("Confirming on phone…", style = Dvnt.Type.body) }
            state.message?.let { item { Text(it, style = Dvnt.Type.body, color = Dvnt.textDim) } }
            item { Text("New call · ${selected.size + 1} of 4 people", style = Dvnt.Type.stamp) }
            item { CallButton("Search people") {
                try { search.launch(RemoteInputIntentHelper.createActionRemoteInputIntent().also {
                    RemoteInputIntentHelper.putRemoteInputsExtra(it, listOf(RemoteInput.Builder("person").setLabel("Find a person").setAllowFreeFormInput(true).build()))
                }) } catch (_: Exception) { searchError = "Search input unavailable. Use your phone." }
            } }
            searchError?.let { item { Text(it, style = Dvnt.Type.caption) } }
            items(state.people, key = { "person:${it.id}" }) { person ->
                CallButton((if (person.id in selected) "✓ " else "") + person.name) {
                    selected = ArrayList(if (person.id in selected) selected - person.id else if (selected.size < 3) selected + person.id else selected)
                }
            }
            if (selected.isNotEmpty() && !state.pending) {
                item { CallButton("Start audio on phone") { action("callDirectoryAction", "start_on_phone", selected.toList()) } }
                item { CallButton("Start video on phone") { action("callDirectoryAction", "start_on_phone", selected.toList(), true) } }
                item { CallButton("Clear selection") { selected = arrayListOf() } }
            }
            item { Text("Recents", style = Dvnt.Type.stamp) }
            if (state.recents.isEmpty()) item { Text("No recent calls", style = Dvnt.Type.caption) }
            items(state.recents, key = { "recent:${it.id}" }) { recent ->
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Text(recent.people.joinToString { it.name }.ifBlank { "Call" }, style = Dvnt.Type.body)
                    Text("${recent.direction} · ${recent.status}", style = Dvnt.Type.caption, color = Dvnt.textDim)
                    if (recent.people.size in 1..3) CallButton("Select people") { selected = ArrayList(recent.people.map { it.id }.distinct()) }
                }
            }
            item { CallButton("Refresh") { scope.launch { repo.refresh() } } }
            item { CallButton("Inbox", onInbox) }
        }
    }
}
@Composable private fun CallButton(label: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = Dvnt.Size.minTouch).clip(RoundedCornerShape(Dvnt.Radius.chip))
        .background(Dvnt.Surface.mid).clickable(role = Role.Button, onClick = onClick).padding(Dvnt.Space.base)) {
        Text(label, style = Dvnt.Type.body, color = Dvnt.cyan)
    }
}
