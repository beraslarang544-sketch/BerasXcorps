package com.berasxcorps.igiport;

public final class IGICpuBridge {
    static {
        System.loadLibrary("igi_cpu_port");
    }

    public static native void nativeInit(int width, int height);
    public static native int nativeStepFrame(float dt, int[] outArgb, int maxPixels);
    public static native void nativeOnInput(int dikCode, int down, int lookDx, int lookDy);
    public static native void nativeOnTouch(int action, float normX, float normY);
}
