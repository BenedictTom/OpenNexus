package com.mcc.console.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.mcc.console.data.AppConfig
import com.mcc.console.data.ConfigStore
import com.mcc.console.net.HostDiscovery

@Composable
fun RootScreen() {
    val ctx = LocalContext.current
    val store = remember { ConfigStore(ctx) }
    val cfg by store.flow.collectAsState(initial = AppConfig.EMPTY)

    // 启动 / topic 变化 / manualHost 清空时, 主动 poll 一次 discovery
    // (NtfyService 的 SSE 也会持续监听,这里只是确保首次启动不用等 Mac 下一次 announce)
    LaunchedEffect(cfg.ntfyTopic, cfg.ntfyServer, cfg.manualHost) {
        if (cfg.ntfyTopic.isNotBlank() && cfg.manualHost.isBlank()) {
            HostDiscovery.poll(cfg.ntfyServer, cfg.ntfyTopic)?.let { discovered ->
                if (discovered != cfg.discoveredHost) store.updateDiscoveredHost(discovered)
            }
        }
    }

    MaterialTheme {
        Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                if (cfg.isComplete) {
                    MainScreen(cfg)
                } else {
                    ConfigScreen(initial = cfg, store = store)
                }
            }
        }
    }
}
