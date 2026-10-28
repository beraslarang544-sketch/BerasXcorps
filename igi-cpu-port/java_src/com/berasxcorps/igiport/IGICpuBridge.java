package com.berasxcorps.igiport;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.view.MotionEvent;

public final class IGICpuBridge {
    static {
        System.loadLibrary("igi_cpu_port");
    }

    public static native void nativeInit(Context ctx, int width, int height);
    public static native int nativeStepFrame(float dt, int[] outArgb, int maxPixels);
    public static native void nativeOnTouchEvent(MotionEvent ev, int viewWidth, int viewHeight);
    public static native void nativeOnTouch(int action, float normX, float normY);
    public static native int nativeOnKey(int androidKeyCode, int down);
    public static native void nativeOnInput(int dikCode, int down, int lookDx, int lookDy);
    public static native void nativeOnActivityResult(Activity act, int reqCode, int resCode, Intent data);
}
