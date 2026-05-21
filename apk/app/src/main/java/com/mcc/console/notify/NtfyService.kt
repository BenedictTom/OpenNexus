package com.mcc.console.notify

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.mcc.console.MainActivity
import com.mcc.console.R
import com.mcc.console.data.AppConfig
import com.mcc.console.data.ConfigStore
import com.mcc.console.data.NtfyAction
import com.mcc.console.data.NtfyMessage
import com.mcc.console.net.HostDiscovery
import com.mcc.console.net.McJson
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

/**
 * 长连接订阅 ntfy.sh/<topic>/sse, 收到推送 → 构造 Android 系统通知。
 *
 * 是否是"审批通知": 看 ntfy actions 数组里有没有 http 动作的 url 匹配 /api/permission/<id>/decision,
 * 有就拆出 requestId + choice + 按钮标签, 转成 Android Notification Action,
 * 按钮 PendingIntent 指向 ApprovalReceiver, 由 receiver 调 Mac /api/permission/<id>/decision 回填决策。
 */
class NtfyService : LifecycleService() {

    private var eventSource: EventSource? = null

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.SECONDS) // SSE 长连接, 无读超时
            .retryOnConnectionFailure(true)
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        startForegroundCompat(buildServiceNotification())
        lifecycleScope.launch {
            ConfigStore(this@NtfyService).flow.collectLatest { cfg ->
                if (cfg.isComplete) subscribe(cfg) else eventSource?.cancel()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }

    override fun onDestroy() {
        eventSource?.cancel()
        super.onDestroy()
    }

    // ───────────────── ntfy 订阅 ─────────────────

    private fun subscribe(cfg: AppConfig) {
        eventSource?.cancel()
        val url = "${cfg.ntfyServer.trimEnd('/')}/${cfg.ntfyTopic}/sse"
        Log.i(TAG, "subscribe → $url")
        val req = Request.Builder().url(url).build()
        eventSource = EventSources.createFactory(httpClient).newEventSource(req, object : EventSourceListener() {
            override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
                handleEvent(data, cfg)
            }

            override fun onFailure(es: EventSource, t: Throwable?, response: Response?) {
                Log.w(TAG, "sse failure, reconnect in 5s: ${t?.message}")
                lifecycleScope.launch {
                    delay(5_000)
                    subscribe(cfg)
                }
            }
        })
    }

    private fun handleEvent(raw: String, cfg: AppConfig) {
        val msg = runCatching { McJson.json.decodeFromString<NtfyMessage>(raw) }
            .onFailure { Log.w(TAG, "parse failed: ${it.message}; raw=$raw") }
            .getOrNull() ?: return
        if (msg.event != "message") return

        // Mac 端的 host 通告: 只更新 ConfigStore,不弹通知
        if (msg.title == HostDiscovery.DISCOVERY_TITLE) {
            val newHost = msg.message?.takeIf { it.isNotBlank() } ?: return
            Log.i(TAG, "host announced: $newHost")
            lifecycleScope.launch {
                ConfigStore(this@NtfyService).updateDiscoveredHost(newHost)
            }
            return
        }

        val approvals = msg.actions.mapNotNull(::parseApproval)
        if (approvals.isNotEmpty()) showApprovalNotification(msg, approvals)
        else showEventNotification(msg)
    }

    private fun parseApproval(a: NtfyAction): ApprovalInfo? {
        if (a.action != "http") return null
        val m = APPROVAL_URL_RE.find(a.url) ?: return null
        val choice = runCatching {
            McJson.json.parseToJsonElement(a.body.orEmpty()).jsonObject["choice"]?.jsonPrimitive?.content
        }.getOrNull() ?: return null
        return ApprovalInfo(requestId = m.groupValues[1], choice = choice, label = a.label)
    }

    private data class ApprovalInfo(val requestId: String, val choice: String, val label: String)

    // ───────────────── 通知构造 ─────────────────

    private fun showApprovalNotification(msg: NtfyMessage, approvals: List<ApprovalInfo>) {
        val notifId = approvals.first().requestId.hashCode() and 0x7fffffff
        val text = msg.message.orEmpty()
        val builder = NotificationCompat.Builder(this, Channels.APPROVAL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(msg.title ?: "Claude 想执行操作")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(openAppPi(msg.click))

        for (a in approvals) {
            val intent = Intent(this, ApprovalReceiver::class.java).apply {
                action = ApprovalReceiver.ACTION
                putExtra(ApprovalReceiver.EXTRA_REQUEST_ID, a.requestId)
                putExtra(ApprovalReceiver.EXTRA_CHOICE, a.choice)
                putExtra(ApprovalReceiver.EXTRA_NOTIF_ID, notifId)
            }
            val pi = PendingIntent.getBroadcast(
                this, "${a.requestId}-${a.choice}".hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.addAction(0, a.label, pi)
        }
        NotificationManagerCompat.from(this).notify(notifId, builder.build())
    }

    private fun showEventNotification(msg: NtfyMessage) {
        val id = msg.id.hashCode() and 0x7fffffff
        val builder = NotificationCompat.Builder(this, Channels.EVENT)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(msg.title ?: "Claude")
            .setContentText(msg.message.orEmpty())
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppPi(msg.click))
        NotificationManagerCompat.from(this).notify(id, builder.build())
    }

    private fun openAppPi(click: String?): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            click?.let { putExtra("click", it) }
        }
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun buildServiceNotification(): Notification {
        return NotificationCompat.Builder(this, Channels.SERVICE)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Claude Console 在后台")
            .setContentText("订阅审批通知中")
            .setContentIntent(openAppPi(null))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun startForegroundCompat(notif: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID_SERVICE, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID_SERVICE, notif)
        }
    }

    companion object {
        private const val TAG = "NtfyService"
        const val NOTIF_ID_SERVICE = 1
        private val APPROVAL_URL_RE = Regex("/api/permission/([\\w-]+)/decision")
    }
}
