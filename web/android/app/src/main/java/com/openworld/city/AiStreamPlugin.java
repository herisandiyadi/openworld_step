package com.openworld.city;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Streams an HTTP POST response line by line to JS ("line" events, then "done" or "error").
 * Native networking skips the WebView CORS preflight (rejected by the AI endpoint) and the
 * mixed-content block for plain-HTTP endpoints, so SSE chat streaming works on Android.
 */
@CapacitorPlugin(name = "AiStream")
public class AiStreamPlugin extends Plugin {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 90000;
    private static final int MAX_ERROR_BODY = 2000;

    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void start(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String body = call.getString("body");
        JSObject headers = call.getObject("headers", new JSObject());
        if (id == null || url == null || body == null) {
            call.reject("id, url and body are required");
            return;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("Only http(s) URLs are allowed");
            return;
        }
        call.resolve();
        executor.execute(() -> run(id, url, headers, body));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            cancelled.add(id);
            HttpURLConnection connection = active.remove(id);
            if (connection != null) connection.disconnect();
        }
        call.resolve();
    }

    private void run(String id, String url, JSObject headers, String body) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            active.put(id, connection);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                connection.setRequestProperty(key, headers.getString(key));
            }
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                emitError(id, status, readLimited(connection.getErrorStream()));
                return;
            }
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (cancelled.contains(id)) return;
                    JSObject event = new JSObject();
                    event.put("id", id);
                    event.put("line", line);
                    notifyListeners("line", event);
                }
            }
            JSObject done = new JSObject();
            done.put("id", id);
            notifyListeners("done", done);
        } catch (Exception error) {
            if (!cancelled.contains(id)) emitError(id, 0, error.getClass().getSimpleName() + ": " + error.getMessage());
        } finally {
            active.remove(id);
            cancelled.remove(id);
            if (connection != null) connection.disconnect();
        }
    }

    private void emitError(String id, int status, String message) {
        JSObject event = new JSObject();
        event.put("id", id);
        event.put("status", status);
        event.put("message", message);
        notifyListeners("error", event);
    }

    private static String readLimited(InputStream stream) {
        if (stream == null) return "";
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && text.length() < MAX_ERROR_BODY) text.append(line).append('\n');
            return text.length() > MAX_ERROR_BODY ? text.substring(0, MAX_ERROR_BODY) : text.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection connection : active.values()) connection.disconnect();
        active.clear();
        executor.shutdownNow();
    }
}