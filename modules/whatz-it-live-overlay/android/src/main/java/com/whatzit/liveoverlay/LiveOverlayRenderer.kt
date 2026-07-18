package com.whatzit.liveoverlay

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import com.margelo.nitro.whatzit.liveoverlay.LiveOverlayEvent
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

internal class LiveOverlayRenderer(
  headshotUri: String?,
  wordmarkUri: String?,
) {
  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val answerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = systemTypeface(900)
    textAlign = Paint.Align.CENTER
  }
  private val bylinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = systemTypeface(600)
    textAlign = Paint.Align.CENTER
  }
  private val timerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = systemTypeface(800)
    textAlign = Paint.Align.CENTER
  }
  private val brandingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    alpha = 235
    isFilterBitmap = true
  }
  private val headshot = decodeBrandingBitmap(headshotUri)
  private val wordmark = decodeBrandingBitmap(wordmarkUri)

  fun draw(canvas: Canvas, event: LiveOverlayEvent?, elapsedMs: Double) {
    drawBranding(canvas)
    if (event == null) return
    val canvasWidth = canvas.width.toFloat()
    val canvasHeight = canvas.height.toFloat()
    val text = event.text.trim().replace(Regex("\\s+"), " ")
    val byline = event.byline
      ?.trim()
      ?.replace(Regex("\\s+"), " ")
      ?.takeIf { it.isNotEmpty() }
      ?.let { "by $it" }
    val horizontalPadding = canvasWidth * 0.0198f
    val verticalPadding = canvasHeight * 0.0154f
    val maximumTextWidth = max(1f, canvasWidth - horizontalPadding * 2)

    answerPaint.textSize = canvasHeight * 0.056f
    var answerWidth = answerPaint.measureText(text)
    if (answerWidth > maximumTextWidth) {
      answerPaint.textSize = max(0.1f, answerPaint.textSize * maximumTextWidth / answerWidth)
      answerWidth = answerPaint.measureText(text)
    }
    bylinePaint.textSize = canvasHeight * 0.035f
    var bylineWidth = byline?.let { bylinePaint.measureText(it) } ?: 0f
    if (bylineWidth > maximumTextWidth) {
      bylinePaint.textSize = max(0.1f, bylinePaint.textSize * maximumTextWidth / bylineWidth)
      bylineWidth = byline?.let { bylinePaint.measureText(it) } ?: 0f
    }
    val timerText = timerTextFor(event, elapsedMs)
    timerPaint.textSize = canvasHeight * 0.0308f
    val timerWidth = timerText?.let { timerPaint.measureText(it) } ?: 0f
    val minimumWidth = canvasWidth * 0.3f
    val width = min(
      canvasWidth,
      max(minimumWidth, max(answerWidth, max(bylineWidth, timerWidth)) + horizontalPadding * 2),
    )
    val answerHeight = lineHeight(answerPaint)
    val bylineHeight = if (byline == null) 0f else lineHeight(bylinePaint)
    val timerHeight = if (timerText == null) 0f else lineHeight(timerPaint)
    val bylineSpacing = if (byline == null) 0f else canvasHeight * 0.0051f
    val timerSpacing = if (timerText == null) 0f else canvasHeight * 0.0051f
    val contentHeight = answerHeight + bylineSpacing + bylineHeight + timerSpacing + timerHeight
    val height = max(canvasHeight * 0.123f, contentHeight + verticalPadding * 2)
    val margin = canvasHeight * 0.133f
    val left = (canvasWidth - width) / 2f
    val bounds = RectF(left, canvasHeight - height - margin, left + width, canvasHeight - margin)
    val colors = colorsFor(event.kind)

    backgroundPaint.color = colors.first
    val cornerRadius = min(width, height) * 0.25f
    canvas.drawRoundRect(bounds, cornerRadius, cornerRadius, backgroundPaint)

    val contentTop = bounds.top + (height - contentHeight) / 2f
    answerPaint.color = colors.second
    val answerBaseline = contentTop - answerPaint.fontMetrics.ascent
    canvas.drawText(text, bounds.centerX(), answerBaseline, answerPaint)
    if (byline != null) {
      bylinePaint.color = colors.second
      bylinePaint.alpha = 184
      val bylineBaseline = contentTop + answerHeight + bylineSpacing - bylinePaint.fontMetrics.ascent
      canvas.drawText(byline, bounds.centerX(), bylineBaseline, bylinePaint)
    }
    if (timerText != null) {
      timerPaint.color = colors.second
      val timerBaseline =
        contentTop + answerHeight + bylineSpacing + bylineHeight + timerSpacing - timerPaint.fontMetrics.ascent
      canvas.drawText(timerText, bounds.centerX(), timerBaseline, timerPaint)
    }
  }

  fun recycle() {
    headshot?.recycle()
    wordmark?.recycle()
  }

  private fun timerTextFor(event: LiveOverlayEvent, elapsedMs: Double): String? {
    val timerEndsAtMs = event.timerEndsAtMs ?: return null
    if (event.kind != "card" && event.kind != "correct" && event.kind != "passed") return null
    val remainingSeconds = max(0, ceil((timerEndsAtMs - elapsedMs) / 1_000.0).toInt())
    return "%d:%02d".format(remainingSeconds / 60, remainingSeconds % 60)
  }

  private fun lineHeight(paint: Paint): Float = paint.fontMetrics.run { descent - ascent }

  private fun drawBranding(canvas: Canvas) {
    if (headshot == null && wordmark == null) return
    val canvasHeight = canvas.height.toFloat()
    val margin = canvasHeight * 0.035f
    val gap = canvasHeight * 0.01f
    val headshotHeight = if (headshot == null) 0f else canvasHeight * 0.144f
    val headshotWidth = headshot?.let {
      headshotHeight * it.width.toFloat() / max(1, it.height).toFloat()
    } ?: 0f
    val wordmarkWidth = if (wordmark == null) 0f else canvasHeight * 0.288f
    val wordmarkHeight = wordmark?.let {
      wordmarkWidth * it.height.toFloat() / max(1, it.width).toFloat()
    } ?: 0f
    val actualGap = if (headshot != null && wordmark != null) gap else 0f
    val brandingHeight = max(headshotHeight, wordmarkHeight)
    headshot?.let {
      canvas.drawBitmap(
        it,
        null,
        RectF(
          margin,
          margin + (brandingHeight - headshotHeight) / 2f,
          margin + headshotWidth,
          margin + (brandingHeight + headshotHeight) / 2f,
        ),
        brandingPaint,
      )
    }
    wordmark?.let {
      val left = margin + headshotWidth + actualGap
      canvas.drawBitmap(
        it,
        null,
        RectF(
          left,
          margin + (brandingHeight - wordmarkHeight) / 2f,
          left + wordmarkWidth,
          margin + (brandingHeight + wordmarkHeight) / 2f,
        ),
        brandingPaint,
      )
    }
  }

  private fun decodeBrandingBitmap(uri: String?): Bitmap? {
    val path = uri?.let { Uri.parse(it) }?.path ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sampleSize = 1
    while (max(bounds.outWidth, bounds.outHeight) / sampleSize > 1_200) sampleSize *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
  }

  private fun colorsFor(kind: String): Pair<Int, Int> = when (kind) {
    "correct" -> Color.argb(163, 135, 237, 170) to Color.rgb(24, 35, 29)
    "passed" -> Color.argb(163, 255, 119, 43) to Color.rgb(2, 2, 2)
    "countdown", "times-up" -> Color.argb(163, 50, 139, 232) to Color.WHITE
    else -> Color.argb(163, 247, 245, 239) to Color.rgb(56, 109, 236)
  }

  private fun systemTypeface(weight: Int): Typeface =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Typeface.create(Typeface.DEFAULT, weight, false)
    } else {
      Typeface.DEFAULT_BOLD
    }
}
