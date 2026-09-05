package com.dvnt.app.wear.ui

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class MessageDiskCacheTest {
    @Test fun durableAccountIsolationAndPurge() {
        val directory = Files.createTempDirectory("dvnt-media").toFile()
        try {
            MessageDiskCache(directory).write("account-a:https://example.com/image", byteArrayOf(1, 2, 3))
            val restored = MessageDiskCache(directory)
            assertArrayEquals(byteArrayOf(1, 2, 3), restored.read("account-a:https://example.com/image"))
            assertNull(restored.read("account-b:https://example.com/image"))
            assertFalse(directory.listFiles()!!.any { it.name.contains("example") })
            restored.clear()
            assertNull(restored.read("account-a:https://example.com/image"))
        } finally { directory.deleteRecursively() }
    }
    @Test fun evictsOldestAndRejectsOversizedWrite() {
        val directory = Files.createTempDirectory("dvnt-media-limit").toFile()
        try {
            val cache = MessageDiskCache(directory, 8)
            cache.write("a", ByteArray(5))
            directory.listFiles()!!.forEach { it.setLastModified(1) }
            cache.write("b", ByteArray(5))
            assertNull(cache.read("a"))
            assertNotNull(cache.read("b"))
            cache.write("too-large", ByteArray(9))
            assertNull(cache.read("too-large"))
            assertTrue(directory.listFiles()!!.sumOf { it.length() } <= 8)
        } finally { directory.deleteRecursively() }
    }
}
