package com.mcc.console.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "mcc-config")

/**
 * APK 配置。两种 host 来源:
 *  - manualHost: 用户手填(如 Tailscale MagicDNS 或局域网 IP),优先用
 *  - discoveredHost: NtfyService 收到 mcc-host 通告自动写入,带完整 scheme
 *
 * effectiveBaseUrl: manualHost 非空 → "http://host:port"; 否则用 discoveredHost(已含 scheme)
 */
data class AppConfig(
    val manualHost: String,
    val port: Int,
    val ntfyTopic: String,
    val ntfyServer: String,
    val discoveredHost: String,
) {
    val effectiveBaseUrl: String?
        get() {
            if (manualHost.isNotBlank()) return "http://$manualHost:$port"
            if (discoveredHost.isNotBlank()) return discoveredHost.trimEnd('/')
            return null
        }

    val baseUrl: String get() = effectiveBaseUrl ?: ""
    val isComplete: Boolean get() = ntfyTopic.isNotBlank() && effectiveBaseUrl != null

    companion object {
        val EMPTY = AppConfig("", 8080, "", "https://ntfy.sh", "")
    }
}

object ConfigKeys {
    val MANUAL_HOST = stringPreferencesKey("manual_host")
    val PORT = intPreferencesKey("port")
    val NTFY_TOPIC = stringPreferencesKey("ntfy_topic")
    val NTFY_SERVER = stringPreferencesKey("ntfy_server")
    val DISCOVERED_HOST = stringPreferencesKey("discovered_host")
}

class ConfigStore(private val context: Context) {

    val flow: Flow<AppConfig> = context.dataStore.data.map { it.toConfig() }

    suspend fun save(cfg: AppConfig) {
        context.dataStore.edit {
            it[ConfigKeys.MANUAL_HOST] = cfg.manualHost
            it[ConfigKeys.PORT] = cfg.port
            it[ConfigKeys.NTFY_TOPIC] = cfg.ntfyTopic
            it[ConfigKeys.NTFY_SERVER] = cfg.ntfyServer
            it[ConfigKeys.DISCOVERED_HOST] = cfg.discoveredHost
        }
    }

    suspend fun updateDiscoveredHost(host: String) {
        context.dataStore.edit { it[ConfigKeys.DISCOVERED_HOST] = host }
    }

    private fun Preferences.toConfig() = AppConfig(
        manualHost = this[ConfigKeys.MANUAL_HOST].orEmpty(),
        port = this[ConfigKeys.PORT] ?: 8080,
        ntfyTopic = this[ConfigKeys.NTFY_TOPIC].orEmpty(),
        ntfyServer = this[ConfigKeys.NTFY_SERVER].orEmpty().ifEmpty { "https://ntfy.sh" },
        discoveredHost = this[ConfigKeys.DISCOVERED_HOST].orEmpty(),
    )
}
