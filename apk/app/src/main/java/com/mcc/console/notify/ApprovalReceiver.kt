package com.mcc.console.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.mcc.console.R
import com.mcc.console.data.ConfigStore
import com.mcc.console.net.McServer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class ApprovalReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val choice = intent.getStringExtra(EXTRA_CHOICE) ?: return
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1)

        // BroadcastReceiver onReceive 在主线程,goAsync 拿到 PendingResult 才能在 coroutine 里干活
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val cfg = ConfigStore(context).flow.first()
                val ok = McServer(cfg).decide(requestId, choice)
                Log.i(TAG, "decide $requestId=$choice -> $ok")
                if (!ok) postFailureToast(context, requestId, choice)
            } catch (t: Throwable) {
                Log.e(TAG, "decide failed", t)
                postFailureToast(context, requestId, choice)
            } finally {
                if (notifId != -1) {
                    NotificationManagerCompat.from(context).cancel(notifId)
                }
                pending.finish()
            }
        }
    }

    private fun postFailureToast(ctx: Context, requestId: String, choice: String) {
        // 用一条简短通知反馈失败,避免静默丢决策
        val notif = NotificationCompat.Builder(ctx, Channels.EVENT)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("决策回传失败")
            .setContentText("$requestId / $choice (检查 Mac 服务和 Tailscale)")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(
            (requestId + choice).hashCode() and 0x7fffffff, notif,
        )
    }

    companion object {
        private const val TAG = "ApprovalReceiver"
        const val ACTION = "com.mcc.console.APPROVAL"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_CHOICE = "choice"
        const val EXTRA_NOTIF_ID = "notif_id"
    }
}
