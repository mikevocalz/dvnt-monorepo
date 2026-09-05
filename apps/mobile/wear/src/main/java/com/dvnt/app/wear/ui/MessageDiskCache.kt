package com.dvnt.app.wear.ui

import java.io.File
import java.security.MessageDigest

/** Private, backup-excluded app storage. Keys include the account generation; no URL is stored. */
internal class MessageDiskCache(private val directory: File, private val limit: Long = 24L * 1024 * 1024) {
    private fun file(key: String) = File(directory, MessageDigest.getInstance("SHA-256").digest(key.toByteArray())
        .joinToString("") { "%02x".format(it) })
    @Synchronized fun read(key: String): ByteArray? = runCatching {
        val entry = file(key)
        if (!entry.isFile || entry.length() > 4 * 1024 * 1024) return null
        entry.readBytes().also { entry.setLastModified(System.currentTimeMillis()) }
    }.getOrNull()
    @Synchronized fun write(key: String, bytes: ByteArray) {
        if (bytes.size > 4 * 1024 * 1024 || bytes.size > limit) return
        runCatching {
            directory.mkdirs()
            val entry = file(key)
            val temporary = File(directory, "${entry.name}.tmp")
            temporary.writeBytes(bytes)
            if (!temporary.renameTo(entry)) { temporary.delete(); return }
            val files = directory.listFiles()?.sortedBy { it.lastModified() } ?: emptyList()
            var total = files.sumOf { it.length() }
            for (old in files) if (total > limit) { val size = old.length(); if (old.delete()) total -= size }
        }
    }
    @Synchronized fun clear() { directory.deleteRecursively() }
}
