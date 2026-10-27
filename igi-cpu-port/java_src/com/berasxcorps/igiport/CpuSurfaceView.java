package com.berasxcorps.igiport;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.view.MotionEvent;
import android.view.View;

public final class CpuSurfaceView extends View {
    private final Bitmap mBitmap;
    private final int[] mPixels;
    private final Rect mDstRect;

    public CpuSurfaceView(Context ctx) {
        super(ctx);
        mBitmap = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888);
        mPixels = new int[230400];
        mDstRect = new Rect();
        IGICpuBridge.nativeInit(640, 360);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        IGICpuBridge.nativeStepFrame(0.033f, mPixels, 230400);
        mBitmap.setPixels(mPixels, 0, 640, 0, 0, 640, 360);
        mDstRect.set(0, 0, getWidth(), getHeight());
        canvas.drawBitmap(mBitmap, null, mDstRect, null);
        postInvalidateOnAnimation();
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        int action = ev.getActionMasked();
        float nx = ev.getX() / (float) getWidth();
        float ny = ev.getY() / (float) getHeight();
        IGICpuBridge.nativeOnTouch(action, nx, ny);
        return true;
    }
}
