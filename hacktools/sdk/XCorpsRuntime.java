package id.berasxcorps.hex;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Java twin of XCorpsRuntime.kt — first-party HEX SDK. */
public final class XCorpsRuntime {
    public static final String ACTION = "id.berasxcorps.hex.BRIDGE";

    public interface Getter { String get(); }
    public interface Setter { void set(String value); }

    public static final class Field {
        public final String id;
        public final String type;
        public final Getter read;
        public final Setter write;
        public Field(String id, String type, Getter read, Setter write) {
            this.id = id; this.type = type; this.read = read; this.write = write;
        }
    }

    private static final Map<String, Field> fields = new ConcurrentHashMap<String, Field>();
    private static final Map<String, String> frozen = new ConcurrentHashMap<String, String>();
    private static volatile float speed = 1f;
    private static volatile boolean attached = false;

    private XCorpsRuntime() {}

    public static void attach(final Context context) {
        if (attached) return;
        attached = true;
        final Context app = context.getApplicationContext();
        loadAssets(app);
        IntentFilter filter = new IntentFilter(ACTION);
        BroadcastReceiver rx = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                if (intent != null) handle(intent);
            }
        };
        if (Build.VERSION.SDK_INT >= 33) {
            app.registerReceiver(rx, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            app.registerReceiver(rx, filter);
        }
    }

    public static void register(String id, String type, Getter read, Setter write) {
        fields.put(id, new Field(id, type, read, write));
    }

    public static float speedScale() { return speed; }

    public static void tickFrozen() {
        for (Map.Entry<String, String> e : frozen.entrySet()) {
            Field f = fields.get(e.getKey());
            if (f != null) f.write.set(e.getValue());
        }
    }

    public static JSONArray snapshot() {
        JSONArray arr = new JSONArray();
        try {
            for (Field f : fields.values()) {
                arr.put(new JSONObject()
                    .put("id", f.id)
                    .put("type", f.type)
                    .put("value", f.read.get()));
            }
        } catch (Exception ignored) {}
        return arr;
    }

    private static void handle(Intent intent) {
        String op = intent.getStringExtra("op");
        if (op == null) op = intent.getStringExtra("type");
        if (op == null) return;
        if ("set".equals(op)) {
            String id = intent.getStringExtra("id");
            String value = intent.getStringExtra("value");
            Field f = id == null ? null : fields.get(id);
            if (f != null && value != null) f.write.set(value);
        } else if ("freeze".equals(op)) {
            String id = intent.getStringExtra("id");
            boolean on = intent.getBooleanExtra("on", true);
            String value = intent.getStringExtra("value");
            if (id == null) return;
            if (on && value != null) frozen.put(id, value); else frozen.remove(id);
        } else if ("speed".equals(op)) {
            try { speed = Float.parseFloat(intent.getStringExtra("scale")); }
            catch (Exception e) { speed = 1f; }
        }
    }

    private static void loadAssets(Context ctx) {
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(ctx.getAssets().open("xcorps/cheats.json")));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            new JSONArray(sb.toString());
        } catch (Exception ignored) {}
    }
}
