package com.dvnt.app.wear

import android.app.RemoteInput
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.input.RemoteInputIntentHelper
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun DoorScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember { DoorRepository.get(context) }
    val state by repository.state.collectAsState()
    val scope = rememberCoroutineScope()
    val list = rememberTransformingLazyColumnState()
    var draft by rememberSaveable(state.accountGen, state.door?.eventId) { mutableStateOf("") }
    var inputError by remember { mutableStateOf<String?>(null) }
    var inputOwner by remember { mutableStateOf<Pair<String, String?>?>(null) }
    val input = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (inputOwner == (state.accountGen to state.door?.eventId)) result.data?.let { intent ->
            RemoteInput.getResultsFromIntent(intent)?.getCharSequence("notice")?.toString()?.let {
                if (it.length <= 400) draft = it else inputError = "Use 400 characters or fewer."
            }
        }
    }
    BackHandler(onBack = onBack)
    LaunchedEffect(state.accountGen) { repository.refresh() }
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item { Text("HOST DOOR", style = Dvnt.Type.stamp, color = Dvnt.cyan) }
            state.door?.let { door ->
                item { Text(door.eventTitle, style = Dvnt.Type.title) }
                item { Text("${door.arrived} arrived · ${door.expected} expected", style = Dvnt.Type.title) }
                item { Text("${door.remaining} remaining", style = Dvnt.Type.body) }
                item { Text("${door.priorityLane} priority lane · ${door.approaching} approaching", style = Dvnt.Type.body) }
                if (state.syncedAt > 0) item { Text("Updated " + DateTimeFormatter.ofPattern("MMM d · HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochSecond(state.syncedAt)), style = Dvnt.Type.caption, color = Dvnt.textDim) }
                if (!state.pending && !state.uncertain) {
                    item { EventButton("Doors are open") { draft = "Doors are open. See you inside." } }
                    item { EventButton("Write notice") {
                        inputOwner = state.accountGen to door.eventId
                        runCatching { input.launch(RemoteInputIntentHelper.createActionRemoteInputIntent().also {
                            RemoteInputIntentHelper.putRemoteInputsExtra(it, listOf(RemoteInput.Builder("notice").setLabel("Notice to all guests").setAllowFreeFormInput(true).build()))
                        }) }.onFailure { inputError = "Text input unavailable. Use your phone." }
                    } }
                    if (draft.isNotBlank()) {
                        item { Text("To all guests: $draft", style = Dvnt.Type.body) }
                        item { EventButton("Send notice") { val text = draft; val owner = state.accountGen; scope.launch { repository.sendNotice(text); if (repository.state.value.accountGen == owner && repository.state.value.result == "Notice sent") draft = "" } } }
                        item { EventButton("Discard") { draft = "" } }
                    }
                }
            } ?: item { Text("No live host event. Open the host dashboard on your phone.", style = Dvnt.Type.body) }
            if (state.pending) item { Text("Confirming on phone…", style = Dvnt.Type.body) }
            state.result?.let { item { Text(it, style = Dvnt.Type.body) } }
            state.error?.let { item { Text(it, style = Dvnt.Type.caption, color = Dvnt.signal) } }
            inputError?.let { item { Text(it, style = Dvnt.Type.caption, color = Dvnt.signal) } }
            item { EventButton(if (state.loading) "Refreshing…" else "Refresh") { if (!state.loading) scope.launch { repository.refresh() } } }
            item { EventButton("Back", onClick = onBack) }
        }
    }
}
