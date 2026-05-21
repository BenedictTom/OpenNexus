package com.mcc.console.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.mcc.console.data.AppConfig
import com.mcc.console.data.ConfigStore
import com.mcc.console.net.HostDiscovery
import com.mcc.console.net.McServer
import kotlinx.coroutines.launch

@Composable
fun ConfigScreen(
    initial: AppConfig,
    store: ConfigStore,
) {
    val scope = rememberCoroutineScope()

    var manualHost by remember { mutableStateOf(initial.manualHost) }
    var port by remember { mutableStateOf(initial.port.toString()) }
    var ntfyTopic by remember { mutableStateOf(initial.ntfyTopic) }
    var ntfyServer by remember { mutableStateOf(initial.ntfyServer.ifEmpty { "https://ntfy.sh" }) }
    var discovered by remember(initial.discoveredHost) { mutableStateOf(initial.discoveredHost) }

    var testResult by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("首次配置", style = MaterialTheme.typography.headlineSmall)
        Text(
            "只需要填 ntfy topic。Mac 端 start.sh 跑起来后会自动通告地址,APK 自动接收。",
            style = MaterialTheme.typography.bodySmall,
        )

        OutlinedTextField(
            value = ntfyTopic, onValueChange = { ntfyTopic = it.trim() },
            label = { Text("ntfy topic（必填）") },
            placeholder = { Text("mcc-xxxxxxxxxxxxxxxx") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = ntfyServer, onValueChange = { ntfyServer = it.trim() },
            label = { Text("ntfy server") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )

        // 自动发现状态
        DiscoveryBanner(
            discovered = discovered,
            ntfyTopic = ntfyTopic,
            ntfyServer = ntfyServer,
            busy = busy,
            onRetry = {
                scope.launch {
                    busy = true
                    val r = HostDiscovery.poll(ntfyServer, ntfyTopic)
                    if (r != null) { discovered = r; store.updateDiscoveredHost(r) }
                    else testResult = "❌ ntfy 上没有 mcc-host 通告。检查 Mac start.sh 是否在跑?"
                    busy = false
                }
            },
        )

        // 高级选项: 手动指定 host (覆盖自动发现)
        Spacer(Modifier.height(8.dp))
        Text("高级（可选）", style = MaterialTheme.typography.titleSmall)
        Text(
            "在家想用 Tailscale 直连(更快)? 填 Mac 的 Tailscale 域名或局域网 IP,会优先用它。",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
            value = manualHost, onValueChange = { manualHost = it.trim() },
            label = { Text("Mac 主机（留空走自动发现）") },
            placeholder = { Text("mac.tailnet-xxxx.ts.net  或  192.168.x.y") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = port, onValueChange = { port = it.filter(Char::isDigit) },
            label = { Text("端口（手填 host 时用）") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                enabled = !busy,
                onClick = {
                    val cfg = build(manualHost, port, ntfyTopic, ntfyServer, discovered)
                    scope.launch {
                        busy = true
                        testResult = if (McServer(cfg).health()) "✅ 连通 ${cfg.effectiveBaseUrl}"
                                     else "❌ 连不上 ${cfg.effectiveBaseUrl ?: "(无地址)"}"
                        busy = false
                    }
                },
            ) { Text("测试连接") }

            Button(
                enabled = ntfyTopic.isNotBlank(),
                onClick = {
                    val cfg = build(manualHost, port, ntfyTopic, ntfyServer, discovered)
                    scope.launch { store.save(cfg) }
                },
            ) { Text("保存") }
        }
        testResult?.let { Text(it) }
    }
}

@Composable
private fun DiscoveryBanner(
    discovered: String, ntfyTopic: String, ntfyServer: String, busy: Boolean, onRetry: () -> Unit,
) {
    val ok = discovered.isNotBlank()
    val bg = if (ok) Color(0xFFE8F5E9) else Color(0xFFFFF3CD)
    val fg = if (ok) Color(0xFF2E7D32) else Color(0xFF6B5004)

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(bg).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            if (ok) "✅ 已自动发现 Mac 地址" else "⏳ 等待 Mac 通告地址",
            style = MaterialTheme.typography.titleSmall, color = fg,
        )
        if (ok) {
            Text(
                discovered,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = fg,
            )
        } else {
            Text(
                "在 Mac 上跑 ./start.sh 后,APK 会在几秒内自动收到地址。也可点下面「重试」主动拉一次。",
                style = MaterialTheme.typography.bodySmall, color = fg,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onRetry, enabled = !busy && ntfyTopic.isNotBlank()) {
                    Text(if (busy) "查询中..." else "重试")
                }
            }
        }
    }
}

private fun build(host: String, port: String, topic: String, server: String, discovered: String) = AppConfig(
    manualHost = host,
    port = port.toIntOrNull() ?: 8080,
    ntfyTopic = topic,
    ntfyServer = server.ifEmpty { "https://ntfy.sh" },
    discoveredHost = discovered,
)
