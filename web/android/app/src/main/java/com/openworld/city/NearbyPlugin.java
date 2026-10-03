package com.openworld.city;

import android.Manifest;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Nearby Connections (Google Play Services) untuk sesi multiplayer lokal tanpa internet.
 * Topologi P2P_STAR seperti docs/MULTIPLAYER.md bagian 4: satu host (advertise) + maksimal 4 klien
 * (discover). Semua pesan game lewat host.
 *
 * Event ke JS (notifyListeners): endpointFound, endpointLost, connectionInitiated, connected,
 * connectionFailed, disconnected, payload. Lihat docs/NEARBY_PLUGIN.md.
 *
 * KETERBATASAN: Payload.Type.BYTES di Nearby SELALU dikirim reliable; flag `reliable` dari JS
 * disimpan apa adanya dan tidak mengubah perilaku transport (tidak ada mode unreliable untuk BYTES).
 * Paket posisi 10-15 Hz jadi ikut reliable; itu diterima untuk v1 lokal (5 perangkat, ~1 KB/s).
 */
@CapacitorPlugin(
    name = "Nearby",
    permissions = {
        // Android 12+ (API 31): izin runtime Bluetooth baru.
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN }, alias = NearbyPlugin.ALIAS_BLUETOOTH_SCAN),
        @Permission(strings = { Manifest.permission.BLUETOOTH_ADVERTISE }, alias = NearbyPlugin.ALIAS_BLUETOOTH_ADVERTISE),
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = NearbyPlugin.ALIAS_BLUETOOTH_CONNECT),
        // Android 13+ (API 33) untuk jalur Wi-Fi Direct.
        @Permission(strings = { Manifest.permission.NEARBY_WIFI_DEVICES }, alias = NearbyPlugin.ALIAS_NEARBY_WIFI),
        // Android 12 ke bawah: Nearby butuh lokasi presisi untuk scan Bluetooth/Wi-Fi.
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = NearbyPlugin.ALIAS_LOCATION)
    }
)
public class NearbyPlugin extends Plugin {
    static final String ALIAS_BLUETOOTH_SCAN = "bluetoothScan";
    static final String ALIAS_BLUETOOTH_ADVERTISE = "bluetoothAdvertise";
    static final String ALIAS_BLUETOOTH_CONNECT = "bluetoothConnect";
    static final String ALIAS_NEARBY_WIFI = "nearbyWifiDevices";
    static final String ALIAS_LOCATION = "location";

    /** Harus sama di semua HP; dipakai Nearby untuk memfilter aplikasi lain. */
    private static final String SERVICE_ID = "com.openworld.city.session";
    private static final int MAX_NAME_LENGTH = 64;
    /** Batas aman payload BYTES Nearby (1 MB); pesan game jauh di bawah ini. */
    private static final int MAX_PAYLOAD_BYTES = 32 * 1024;

    private ConnectionsClient connections;
    /** endpointId -> nama endpoint, untuk endpoint yang ditemukan atau sedang diminta. */
    private final Map<String, String> known = new ConcurrentHashMap<>();
    /** endpointId -> nama, hanya yang benar-benar tersambung. */
    private final Map<String, String> connected = new ConcurrentHashMap<>();
    private boolean advertising = false;
    private boolean discovering = false;

    @Override
    public void load() {
        connections = Nearby.getConnectionsClient(getContext());
    }

    // ---------------------------------------------------------------- izin

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionReport());
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        String[] aliases = requiredAliases();
        boolean complete = true;
        for (String alias : aliases) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                complete = false;
                break;
            }
        }
        if (complete) {
            call.resolve(permissionReport());
            return;
        }
        requestPermissionForAliases(aliases, call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        call.resolve(permissionReport());
    }

    /** Alias yang relevan untuk versi Android yang sedang jalan. */
    private String[] requiredAliases() {
        List<String> aliases = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            aliases.add(ALIAS_BLUETOOTH_SCAN);
            aliases.add(ALIAS_BLUETOOTH_ADVERTISE);
            aliases.add(ALIAS_BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            aliases.add(ALIAS_NEARBY_WIFI);
        } else {
            // Android 12 ke bawah: lokasi presisi wajib untuk scan.
            aliases.add(ALIAS_LOCATION);
        }
        return aliases.toArray(new String[0]);
    }

    /** { nearby: granted|denied|prompt, <alias>: state, ... } */
    private JSObject permissionReport() {
        JSObject result = new JSObject();
        boolean allGranted = true;
        for (String alias : requiredAliases()) {
            PermissionState state = getPermissionState(alias);
            result.put(alias, state == null ? PermissionState.PROMPT.toString() : state.toString());
            if (state != PermissionState.GRANTED) allGranted = false;
        }
        result.put("nearby", allGranted ? PermissionState.GRANTED.toString() : PermissionState.PROMPT.toString());
        return result;
    }

    private boolean missingPermissions(PluginCall call) {
        for (String alias : requiredAliases()) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                call.reject("Izin " + alias + " belum diberikan. Panggil requestPermissions() lebih dulu.");
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------- advertise/discover

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        String localName = call.getString("localName");
        if (localName == null || localName.trim().isEmpty()) {
            call.reject("localName wajib diisi");
            return;
        }
        String name = localName.trim();
        if (name.length() > MAX_NAME_LENGTH) name = name.substring(0, MAX_NAME_LENGTH);
        if (missingPermissions(call)) return;

        AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
        connections
            .startAdvertising(name, SERVICE_ID, connectionLifecycle, options)
            .addOnSuccessListener(unused -> {
                advertising = true;
                call.resolve();
            })
            .addOnFailureListener(error -> call.reject("startAdvertising gagal: " + describe(error)));
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (missingPermissions(call)) return;
        DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
        connections
            .startDiscovery(SERVICE_ID, endpointDiscovery, options)
            .addOnSuccessListener(unused -> {
                discovering = true;
                call.resolve();
            })
            .addOnFailureListener(error -> call.reject("startDiscovery gagal: " + describe(error)));
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        stopEverything();
        call.resolve();
    }

    private void stopEverything() {
        if (connections == null) return;
        connections.stopAdvertising();
        connections.stopDiscovery();
        connections.stopAllEndpoints(); // = disconnect dari semua endpoint
        advertising = false;
        discovering = false;
        known.clear();
        connected.clear();
    }

    // ------------------------------------------------------------- koneksi

    @PluginMethod
    public void requestConnection(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null || endpointId.trim().isEmpty()) {
            call.reject("endpointId wajib diisi");
            return;
        }
        String localName = call.getString("localName", "");
        if (localName == null || localName.trim().isEmpty()) localName = Build.MODEL == null ? "player" : Build.MODEL;
        if (missingPermissions(call)) return;
        if (!known.containsKey(endpointId)) {
            call.reject("endpointId tidak dikenal: " + endpointId);
            return;
        }
        connections
            .requestConnection(localName.trim(), endpointId, connectionLifecycle)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("requestConnection gagal: " + describe(error)));
    }

    @PluginMethod
    public void acceptConnection(PluginCall call) {
        String endpointId = requireKnownEndpoint(call);
        if (endpointId == null) return;
        connections
            .acceptConnection(endpointId, payloadCallback)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("acceptConnection gagal: " + describe(error)));
    }

    @PluginMethod
    public void rejectConnection(PluginCall call) {
        String endpointId = requireKnownEndpoint(call);
        if (endpointId == null) return;
        connections
            .rejectConnection(endpointId)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> call.reject("rejectConnection gagal: " + describe(error)));
    }

    private String requireKnownEndpoint(PluginCall call) {
        String endpointId = call.getString("endpointId");
        if (endpointId == null || endpointId.trim().isEmpty()) {
            call.reject("endpointId wajib diisi");
            return null;
        }
        if (!known.containsKey(endpointId)) {
            call.reject("endpointId tidak dikenal: " + endpointId);
            return null;
        }
        return endpointId;
    }

    // --------------------------------------------------------------- kirim

    /**
     * data = string base64 dari Uint8Array. endpointId kosong/absen = broadcast ke semua yang tersambung.
     * reliable hanya dicatat: Payload BYTES Nearby selalu reliable (tidak ada mode unreliable).
     */
    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("data (base64) wajib diisi");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.NO_WRAP);
        } catch (IllegalArgumentException error) {
            call.reject("data bukan base64 yang valid");
            return;
        }
        if (bytes == null || bytes.length == 0) {
            call.reject("data kosong");
            return;
        }
        if (bytes.length > MAX_PAYLOAD_BYTES) {
            call.reject("data terlalu besar (" + bytes.length + " byte, maksimal " + MAX_PAYLOAD_BYTES + ")");
            return;
        }
        String endpointId = call.getString("endpointId");
        List<String> targets = new ArrayList<>();
        if (endpointId == null || endpointId.trim().isEmpty()) {
            targets.addAll(connected.keySet());
            if (targets.isEmpty()) {
                call.reject("Tidak ada endpoint yang tersambung");
                return;
            }
        } else {
            if (!connected.containsKey(endpointId)) {
                call.reject("endpointId tidak tersambung: " + endpointId);
                return;
            }
            targets.add(endpointId);
        }
        Payload payload = Payload.fromBytes(bytes);
        connections
            .sendPayload(targets, payload)
            .addOnSuccessListener(unused -> {
                JSObject result = new JSObject();
                result.put("sentTo", targets.size());
                // Catat keterbatasan supaya sisi JS tidak mengira ada jalur unreliable.
                result.put("reliable", true);
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject("send gagal: " + describe(error)));
    }

    @PluginMethod
    public void connectedEndpoints(PluginCall call) {
        JSArray list = new JSArray();
        for (Map.Entry<String, String> entry : connected.entrySet()) {
            JSObject item = new JSObject();
            item.put("endpointId", entry.getKey());
            item.put("name", entry.getValue());
            list.put(item);
        }
        JSObject result = new JSObject();
        result.put("endpoints", list);
        result.put("advertising", advertising);
        result.put("discovering", discovering);
        call.resolve(result);
    }

    // -------------------------------------------------------------- callback

    private final EndpointDiscoveryCallback endpointDiscovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            String name = info.getEndpointName();
            known.put(endpointId, name == null ? "" : name);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            event.put("name", name == null ? "" : name);
            notifyListeners("endpointFound", event);
        }

        @Override
        public void onEndpointLost(String endpointId) {
            known.remove(endpointId);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            notifyListeners("endpointLost", event);
        }
    };

    private final ConnectionLifecycleCallback connectionLifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
            String name = info.getEndpointName();
            known.put(endpointId, name == null ? "" : name);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            event.put("name", name == null ? "" : name);
            event.put("authDigits", authDigits(info));
            notifyListeners("connectionInitiated", event);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution resolution) {
            int status = resolution.getStatus().getStatusCode();
            if (status == ConnectionsStatusCodes.STATUS_OK) {
                String name = known.get(endpointId);
                connected.put(endpointId, name == null ? "" : name);
                JSObject event = new JSObject();
                event.put("endpointId", endpointId);
                event.put("name", name == null ? "" : name);
                notifyListeners("connected", event);
                return;
            }
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            event.put("status", status);
            event.put(
                "message",
                status == ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED
                    ? "Koneksi ditolak salah satu perangkat"
                    : "Koneksi gagal (kode " + status + ")"
            );
            notifyListeners("connectionFailed", event);
        }

        @Override
        public void onDisconnected(String endpointId) {
            connected.remove(endpointId);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            notifyListeners("disconnected", event);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
            if (payload.getType() != Payload.Type.BYTES) return; // hanya BYTES yang dipakai protokol game
            byte[] bytes = payload.asBytes();
            if (bytes == null) return;
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            event.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            notifyListeners("payload", event);
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
            // BYTES tiba sekaligus; tidak perlu progres per chunk.
        }
    };

    /**
     * Kode konfirmasi 4 digit (docs/MULTIPLAYER.md bagian 5). Diturunkan DETERMINISTIK dari token
     * autentikasi koneksi, yang identik di kedua perangkat, jadi kedua HP menampilkan angka sama.
     * Dipakai getAuthenticationDigits() kalau tersedia; kalau tidak, token mentah di-fold ke 4 digit
     * dengan FNV-1a (urutan byte sama di kedua sisi, jadi hasilnya sama).
     */
    private static String authDigits(ConnectionInfo info) {
        String digits = info.getAuthenticationDigits();
        if (digits != null) {
            String onlyDigits = digits.replaceAll("\\D", "");
            if (onlyDigits.length() >= 4) return onlyDigits.substring(0, 4);
            if (!onlyDigits.isEmpty()) return pad(Integer.parseInt(onlyDigits) % 10000);
        }
        byte[] token = info.getRawAuthenticationToken();
        if (token == null || token.length == 0) return "0000";
        long hash = 0x811c9dc5L;
        for (byte value : token) {
            hash ^= (value & 0xff);
            hash = (hash * 0x01000193L) & 0xffffffffL;
        }
        return pad((int) (hash % 10000));
    }

    private static String pad(int value) {
        return String.format("%04d", Math.abs(value) % 10000);
    }

    private static String describe(Exception error) {
        String message = error.getMessage();
        return message == null ? error.getClass().getSimpleName() : message;
    }

    @Override
    protected void handleOnDestroy() {
        stopEverything();
    }
}
