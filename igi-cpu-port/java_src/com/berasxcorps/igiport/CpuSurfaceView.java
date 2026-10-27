package com.berasxcorps.igiport;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;

public final class CpuSurfaceView extends View {
    private final Bitmap mBitmap;
    private final int[] mPixels;
    private final Rect mDstRect;

    public CpuSurfaceView(Context ctx) {
        super(ctx);
        setFocusable(true);
        setFocusableInTouchMode(true);
        mBitmap = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888);
        mPixels = new int[307200];
        mDstRect = new Rect();
        IGICpuBridge.nativeInit(ctx, 640, 480);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        IGICpuBridge.nativeStepFrame(0.016667f, mPixels, 307200);
        mBitmap.setPixels(mPixels, 0, 640, 0, 0, 640, 480);
        mDstRect.set(0, 0, getWidth(), getHeight());
        canvas.drawBitmap(mBitmap, null, mDstRect, null);
        postInvalidateOnAnimation();
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        IGICpuBridge.nativeOnTouchEvent(ev, getWidth(), getHeight());
        return true;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        return IGICpuBridge.nativeOnKey(keyCode, 1) != 0;
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        return IGICpuBridge.nativeOnKey(keyCode, 0) != 0;
    }
}
