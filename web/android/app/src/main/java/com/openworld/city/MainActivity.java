package com.openworld.city;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AiStreamPlugin.class);
        super.onCreate(savedInstanceState);
    }
}