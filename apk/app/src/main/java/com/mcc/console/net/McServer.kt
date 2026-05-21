package com.mcc.console.net

import com.mcc.console.data.AppConfig
import com.mcc.console.data.DecisionBody
import com.mcc.console.data.SessionView
import com.mcc.console.data.TunnelState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object McJson {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
}

class McServer(private val cfg: AppConfig) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS) // tunnel start 服务端可能阻塞 8-15s
        .build()

    private val jsonMt = "application/json; charset=utf-8".toMediaType()

    suspend fun health(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            client.newCall(Request.Builder().url("${cfg.baseUrl}/api/health").build()).execute()
                .use { it.isSuccessful }
        }.getOrDefault(false)
    }

    suspend fun listSessions(): List<SessionView> = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url("${cfg.baseUrl}/api/sessions").build()).execute().use { r ->
            if (!r.isSuccessful) return@withContext emptyList()
            val body = r.body?.string().orEmpty()
            McJson.json.decodeFromString(body)
        }
    }

    suspend fun decide(requestId: String, choice: String, reason: String? = null): Boolean =
        withContext(Dispatchers.IO) {
            val body = McJson.json.encodeToString(DecisionBody(choice, reason)).toRequestBody(jsonMt)
            client.newCall(
                Request.Builder()
                    .url("${cfg.baseUrl}/api/permission/$requestId/decision")
                    .post(body)
                    .build()
            ).execute().use { it.isSuccessful }
        }

    // ───────────────── Cloudflare 公网分享 ─────────────────

    suspend fun tunnelStatus(): TunnelState? = withContext(Dispatchers.IO) {
        runCatching {
            client.newCall(Request.Builder().url("${cfg.baseUrl}/api/tunnel").build()).execute().use { r ->
                if (!r.isSuccessful) null else McJson.json.decodeFromString<TunnelState>(r.body!!.string())
            }
        }.getOrNull()
    }

    suspend fun tunnelStart(): Result<TunnelState> = withContext(Dispatchers.IO) {
        runCatching {
            val body = "".toRequestBody(jsonMt)
            client.newCall(
                Request.Builder().url("${cfg.baseUrl}/api/tunnel").post(body).build(),
            ).execute().use { r ->
                val text = r.body?.string().orEmpty()
                if (!r.isSuccessful) error("HTTP ${r.code}: $text")
                McJson.json.decodeFromString<TunnelState>(text)
            }
        }
    }

    suspend fun tunnelStop(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            client.newCall(
                Request.Builder().url("${cfg.baseUrl}/api/tunnel").delete().build(),
            ).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }
}
