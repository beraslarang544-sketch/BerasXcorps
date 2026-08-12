package id.berasxcorps.hex

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.ConcurrentHashMap

/**
 * HEX first-party runtime.
 * Drop this file into YOUR Android game and call [XCorpsRuntime.attach] from Application.onCreate.
 *
 * It reads assets/xcorps/*.json (injected by HEX Studio without decompile)
 * and applies values YOU registered. It cannot see another app's memory.
 */
object XCorpsRuntime {
    const val ACTION = "id.berasxcorps.hex.BRIDGE"

    private val fields = ConcurrentHashMap<String, Field>()
    private val frozen = ConcurrentHashMap<String, String>()
    @Volatile private var speed = 1f
    @Volatile private var attached = false
    private var app: Context? = null

    data class Field(
        val id: String,
        val type: String,
        val read: () -> String,
        val write: (String) -> Unit
    )

    fun attach(context: Context) {
        if (attached) return
        attached = true
        app = context.applicationContext
        loadAssets(context.applicationContext)
        val filter = IntentFilter(ACTION)
        val rx = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                handle(intent ?: return)
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            context.applicationContext.registerReceiver(rx, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            context.applicationContext.registerReceiver(rx, filter)
        }
    }

    fun register(id: String, type: String, read: () -> String, write: (String) -> Unit) {
        fields[id] = Field(id, type, read, write)
    }

    fun registerInt(id: String, get: () -> Int, set: (Int) -> Unit) =
        register(id, "i32", { get().toString() }, { set(it.toIntOrNull() ?: return@register) })

    fun registerFloat(id: String, get: () -> Float, set: (Float) -> Unit) =
        register(id, "f32", { get().toString() }, { set(it.toFloatOrNull() ?: return@register) })

    fun speedScale(): Float = speed

    fun tickFrozen() {
        for ((id, value) in frozen) {
            fields[id]?.write?.invoke(value)
        }
    }

    fun snapshot(): JSONArray {
        val arr = JSONArray()
        for ((_, f) in fields) {
            arr.put(JSONObject()
                .put("id", f.id)
                .put("type", f.type)
                .put("value", f.read()))
        }
        return arr
    }

    private fun handle(intent: Intent) {
        when (intent.getStringExtra("op") ?: intent.getStringExtra("type")) {
            "set" -> {
                val id = intent.getStringExtra("id") ?: return
                val value = intent.getStringExtra("value") ?: return
                fields[id]?.write?.invoke(value)
            }
            "freeze" -> {
                val id = intent.getStringExtra("id") ?: return
                val on = intent.getBooleanExtra("on", true)
                val value = intent.getStringExtra("value")
                if (on && value != null) frozen[id] = value else frozen.remove(id)
            }
            "speed" -> speed = intent.getStringExtra("scale")?.toFloatOrNull() ?: 1f
            "ping" -> { /* studio heartbeat */ }
        }
    }

    private fun loadAssets(ctx: Context) {
        try {
            val json = readAsset(ctx, "xcorps/cheats.json") ?: return
            val arr = JSONArray(json)
            // Cheats are descriptors. Actual binding happens via register* in game code.
            void(arr)
        } catch (_: Throwable) {
        }
    }

    private fun readAsset(ctx: Context, path: String): String? {
        return try {
            ctx.assets.open(path).use { input ->
                BufferedReader(InputStreamReader(input)).readText()
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun void(v: Any?) { /* keep cheats file referenced */ }
}
