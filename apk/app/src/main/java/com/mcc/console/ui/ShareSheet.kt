package com.mcc.console.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mcc.console.data.AppConfig
import com.mcc.console.data.TunnelState
import com.mcc.console.net.McServer
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(cfg: AppConfig, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val server = remember(cfg) { McServer(cfg) }

    var state by remember { mutableStateOf<TunnelState?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // 首次 + 每 5s 拉一次状态
    LaunchedEffect(cfg) {
        while (true) {
            state = server.tunnelStatus()
            delay(5_000)
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("公网临时分享", style = MaterialTheme.typography.titleLarge)

            WarningBanner()

            val s = state
            when {
                loading -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                s?.active == true && s.url != null -> ActiveBlock(
                    state = s,
                    onStop = {
                        scope.launch {
                            loading = true; error = null
                            server.tunnelStop()
                            state = server.tunnelStatus()
                            loading = false
                        }
                    },
                )
                else -> InactiveBlock(
                    onStart = {
                        scope.launch {
                            loading = true; error = null
                            server.tunnelStart()
                                .onSuccess { state = it }
                                .onFailure { error = it.message ?: "未知错误" }
                            loading = false
                        }
                    },
                )
            }

            error?.let {
                Text("启动失败: $it", color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun WarningBanner() {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFFFF3CD))
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Default.Warning, null, tint = Color(0xFFB54708))
        Spacer(Modifier.width(8.dp))
        Text(
            "URL 即密码: 拿到此 URL 的任何人能完整控制你的终端。\n请勿在公开场合(微信群/论坛)分享。",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF6B5004),
        )
    }
}

@Composable
private fun InactiveBlock(onStart: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "当前未分享。开启后生成临时 trycloudflare.com URL,关闭即失效。",
            style = MaterialTheme.typography.bodyMedium,
        )
        Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("开始分享")
        }
    }
}

@Composable
private fun ActiveBlock(state: TunnelState, onStop: () -> Unit) {
    val ctx = LocalContext.current
    val url = state.url!!
    val started = state.startedAt ?: System.currentTimeMillis()
    var elapsed by remember { mutableStateOf("") }
    LaunchedEffect(started) {
        while (true) {
            val secs = (System.currentTimeMillis() - started) / 1000
            elapsed = when {
                secs < 60 -> "${secs}s"
                secs < 3600 -> "${secs / 60}m ${secs % 60}s"
                else -> "${secs / 3600}h ${(secs % 3600) / 60}m"
            }
            delay(1000)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(Color(0xFF22C55E)),
            )
            Spacer(Modifier.width(8.dp))
            Text("已上线 · $elapsed", style = MaterialTheme.typography.titleSmall)
        }

        // URL 框 + 复制 / 分享
        Surface(tonalElevation = 2.dp, shape = RoundedCornerShape(8.dp)) {
            Column(Modifier.padding(10.dp)) {
                Text(
                    url,
                    style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 2,
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { copyToClipboard(ctx, url) }) {
                        Icon(Icons.Default.ContentCopy, null); Spacer(Modifier.width(4.dp)); Text("复制")
                    }
                    TextButton(onClick = { systemShare(ctx, url) }) {
                        Icon(Icons.Default.Share, null); Spacer(Modifier.width(4.dp)); Text("分享")
                    }
                }
            }
        }

        // QR
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Surface(tonalElevation = 1.dp, shape = RoundedCornerShape(8.dp)) {
                QrCodeImage(url, sizePx = 600, modifier = Modifier.size(220.dp).padding(10.dp))
            }
        }

        OutlinedButton(
            onClick = onStop,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) {
            Icon(Icons.Default.Stop, null); Spacer(Modifier.width(8.dp)); Text("立刻关闭")
        }
    }
}

private fun copyToClipboard(ctx: Context, text: String) {
    val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("mcc-tunnel", text))
    Toast.makeText(ctx, "已复制", Toast.LENGTH_SHORT).show()
}

private fun systemShare(ctx: Context, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    ctx.startActivity(Intent.createChooser(intent, "分享 URL").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
}
