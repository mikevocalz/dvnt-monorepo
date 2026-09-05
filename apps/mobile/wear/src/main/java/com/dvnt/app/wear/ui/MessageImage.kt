package com.dvnt.app.wear.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.wear.compose.material3.Text
import com.dvnt.app.wear.Dvnt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.net.URL

private val bitmaps = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
}
private val imageTransfers = Semaphore(2)
private val imageLock = Any()
private var imageRevision = 0L
private var diskCache: MessageDiskCache? = null
fun clearMessageImages(context: android.content.Context? = null) { synchronized(imageLock) {
    imageRevision++; bitmaps.evictAll(); diskCache?.clear()
    context?.let { java.io.File(it.noBackupFilesDir, "message-images").deleteRecursively() }
} }

@Composable
fun MessageImage(url: String?, account: String, description: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    val context = LocalContext.current.applicationContext
    val disk = remember(context) { synchronized(imageLock) {
        diskCache ?: MessageDiskCache(java.io.File(context.noBackupFilesDir, "message-images")).also { diskCache = it }
    } }
    var attempt by remember(url, account) { mutableIntStateOf(0) }
    var failed by remember(url, account, attempt) { mutableStateOf(false) }
    val bitmap by produceState<Bitmap?>(null, url, account, attempt) {
        value = imageTransfers.withPermit { withContext(Dispatchers.IO) {
            if (account.isBlank() || url.isNullOrBlank()) return@withContext null
            val key = "$account:$url"
            val revision = synchronized(imageLock) { imageRevision }
            synchronized(imageLock) { bitmaps.get(key) }?.let { return@withContext it }
            runCatching {
                val address = URL(url)
                require(address.protocol == "https" && address.userInfo == null)
                val cached = synchronized(imageLock) { disk.read(key) }
                val bytes = cached ?: run {
                val connection = address.openConnection().apply { connectTimeout = 8000; readTimeout = 8000 }
                connection.getInputStream().use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 4 * 1024 * 1024)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                }
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                require(bounds.outWidth > 0 && bounds.outHeight > 0)
                var sample = 1
                while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 512) sample *= 2
                val result = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Image unavailable")
                synchronized(imageLock) {
                    if (revision != imageRevision) return@runCatching null
                    bitmaps.put(key, result)
                    if (cached == null) disk.write(key, bytes)
                    result
                }
            }.getOrNull()
        }
        }
        failed = value == null
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap!!.asImageBitmap(), description, Modifier.matchParentSize(), contentScale = contentScale)
        else Text(if (failed) "Image unavailable · Retry" else "Loading image…", style = Dvnt.Type.caption,
            modifier = Modifier.clickable { attempt++ })
    }
}
