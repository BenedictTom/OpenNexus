package com.mcc.console.net

import com.mcc.console.data.NtfyMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * 从 ntfy 拉最近的 mcc-host 公告,APK 启动 / 用户切换 topic 时调一次。
 *
 * Mac 端 server/tunnel.ts 在 cloudflared 起来后 publish:
 *   { title: "mcc-host", message: "<tunnel-url>", priority: 1 }
 *
 * 这里用 ntfy 的 poll + filter 参数精确捞最近 12h 内的最新一条。
 */
object HostDiscovery {

    const val DISCOVERY_TITLE = "mcc-host"

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    suspend fun poll(ntfyServer: String, topic: String): String? = withContext(Dispatchers.IO) {
        if (topic.isBlank()) return@withContext null
        val url = "${ntfyServer.trimEnd('/')}/$topic/json?poll=1&since=12h"
        runCatching {
            client.newCall(Request.Builder().url(url).build()).execute().use { r ->
                if (!r.isSuccessful) return@withContext null
                // ntfy /json 是 NDJSON, 每行一个 message
                val lines = r.body!!.string().split("\n").filter { it.isNotBlank() }
                // 取最近的 mcc-host
                lines.asReversed().firstNotNullOfOrNull { line ->
                    runCatching {
                        val msg = McJson.json.decodeFromString<NtfyMessage>(line)
                        if (msg.title == DISCOVERY_TITLE && !msg.message.isNullOrBlank()) msg.message
                        else null
                    }.getOrNull()
                }
            }
        }.getOrNull()
    }
}
