package com.dvnt.app.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.dvnt.app.wear.ui.MessageImage

@Composable
fun BroadcastScreen(eventId: String? = null, onBack: () -> Unit) {
    val state by BroadcastRepository.get(LocalContext.current).state.collectAsState()
    val rows = state.broadcasts.filter { eventId == null || it.eventId == eventId }
    val list = rememberTransformingLazyColumnState()
    BackHandler(onBack = onBack)
    ScreenScaffold(scrollState = list) { padding ->
        TransformingLazyColumn(state = list, contentPadding = padding, modifier = Modifier.fillMaxSize().padding(horizontal = Dvnt.Space.base)) {
            item { Text("FROM THE HOST", style = Dvnt.Type.stamp, color = Dvnt.cyan) }
            if (rows.isEmpty()) item { Text("No host notices synced. Open DVNT on your phone to refresh.", style = Dvnt.Type.body) }
            items(rows, key = { it.id }) { row ->
                Column(Modifier.fillMaxWidth().padding(vertical = Dvnt.Space.base)) {
                    row.imageURL?.let { MessageImage(it, state.accountGen, "${row.eventTitle} artwork", Modifier.fillMaxWidth().height(80.dp)) }
                    Text(row.eventTitle, style = Dvnt.Type.title)
                    Text("${row.host} · ${if (row.read) "Read on phone" else "Unread on phone"}", style = Dvnt.Type.caption, color = Dvnt.textDim)
                    Text(row.body, style = Dvnt.Type.body)
                    Text(java.time.Instant.ofEpochSecond(row.createdAt).atZone(java.time.ZoneId.systemDefault())
                        .format(java.time.format.DateTimeFormatter.ofPattern("EEE HH:mm")), style = Dvnt.Type.caption, color = Dvnt.textDim)
                }
            }
            item { Text("Cached notices · older history on phone", style = Dvnt.Type.caption, color = Dvnt.textDim) }
            item { EventButton("Back", onBack) }
        }
    }
}
