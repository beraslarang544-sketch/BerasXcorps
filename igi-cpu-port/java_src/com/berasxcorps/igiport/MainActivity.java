package com.berasxcorps.igiport;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Window;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(new CpuSurfaceView(this));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        IGICpuBridge.nativeOnActivityResult(this, requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        IGICpuBridge.nativeOnKey(111, 1);
        IGICpuBridge.nativeOnKey(111, 0);
    }
}
