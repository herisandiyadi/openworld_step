package com.openworld.city;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Pattern;

/**
 * On-device SQLite database (openworld.db) for the player profile. Uses Android's built-in SQLite,
 * so no extra dependency. All writes use ContentValues (parameterised), never string-built SQL.
 */
@CapacitorPlugin(name = "PlayerDb")
public class PlayerDbPlugin extends Plugin {
    private static final String TABLE = "player_profile";
    private static final int MIN_LENGTH = 2;
    private static final int MAX_LENGTH = 20;
    /** Same rule as src/state/profile.ts: letters/digits first, then letters, digits, space, . _ - */
    private static final Pattern USERNAME = Pattern.compile("^[\\p{L}\\p{N}][\\p{L}\\p{N} ._-]*$");

    private PlayerDbHelper helper;

    @Override
    public void load() {
        helper = new PlayerDbHelper(getContext());
    }

    @PluginMethod
    public void getProfile(PluginCall call) {
        try (Cursor cursor = helper.getReadableDatabase().query(
                TABLE, new String[] { "username", "created_at", "updated_at" }, "id = 1", null, null, null, null)) {
            JSObject result = new JSObject();
            if (cursor.moveToFirst()) {
                JSObject profile = new JSObject();
                profile.put("username", cursor.getString(0));
                profile.put("createdAt", cursor.getLong(1));
                profile.put("updatedAt", cursor.getLong(2));
                result.put("profile", profile);
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Gagal membaca profil: " + error.getMessage());
        }
    }

    @PluginMethod
    public void saveProfile(PluginCall call) {
        String raw = call.getString("username");
        String username = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
        int length = username.codePointCount(0, username.length());
        if (length < MIN_LENGTH || length > MAX_LENGTH || !USERNAME.matcher(username).matches()) {
            call.reject("Username tidak valid");
            return;
        }
        long now = System.currentTimeMillis();
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues update = new ContentValues();
            update.put("username", username);
            update.put("updated_at", now);
            if (db.update(TABLE, update, "id = 1", null) == 0) {
                ContentValues insert = new ContentValues(update);
                insert.put("id", 1);
                insert.put("created_at", now);
                db.insertOrThrow(TABLE, null, insert);
            }
            db.setTransactionSuccessful();
        } catch (Exception error) {
            call.reject("Gagal menyimpan profil: " + error.getMessage());
            return;
        } finally {
            db.endTransaction();
        }
        getProfile(call);
    }

    @Override
    protected void handleOnDestroy() {
        if (helper != null) helper.close();
    }

    private static class PlayerDbHelper extends SQLiteOpenHelper {
        private static final String NAME = "openworld.db";
        private static final int VERSION = 1;

        PlayerDbHelper(Context context) {
            super(context, NAME, null, VERSION);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            // Single-row table: one local player per install.
            db.execSQL(
                "CREATE TABLE " + TABLE + " ("
                    + "id INTEGER PRIMARY KEY CHECK (id = 1), "
                    + "username TEXT NOT NULL, "
                    + "created_at INTEGER NOT NULL, "
                    + "updated_at INTEGER NOT NULL)"
            );
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Future schema migrations go here (never drop the player's data).
        }
    }
}