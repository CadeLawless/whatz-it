package com.whatzit.videoexport

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

@OptimizedRecord
class VideoOverlayEvent(
  @Field val atMs: Double,
  @Field val kind: String,
  @Field val text: String,
  @Field val timerEndsAtMs: Double? = null
) : Record

@OptimizedRecord
class RoundVideoSegment(
  @Field val videoUri: String,
  @Field val audioUri: String? = null
) : Record

@OptIn(UnstableApi::class)
class WhatzItVideoExportModule : Module() {
  private val activeExports = ConcurrentHashMap<String, Transformer>()

  override fun definition() = ModuleDefinition {
    Name("WhatzItVideoExport")

    AsyncFunction("beginOrientationScreenshotShield") { _: String? -> false }

    AsyncFunction("finishOrientationScreenshotShield") { false }

    AsyncFunction("stitchRoundVideoSegments") {
        segments: List<RoundVideoSegment>,
        promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null || segments.isEmpty()) {
        promise.reject("ERR_VIDEO_STITCH", "No application context or video segments are available.", null)
        return@AsyncFunction
      }
      Handler(Looper.getMainLooper()).post {
        val exportId = UUID.randomUUID().toString()
        val outputFile = File(context.cacheDir, "whatz-it-stitched-$exportId.mp4")
        val items = segments.map {
          EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(it.videoUri))).build()
        }
        val sequence = EditedMediaItemSequence.withAudioAndVideoFrom(items)
        val composition = Composition.Builder(listOf(sequence)).build()
        val listener = object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            activeExports.remove(exportId)
            promise.resolve(Uri.fromFile(outputFile).toString())
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
          ) {
            activeExports.remove(exportId)
            outputFile.delete()
            promise.reject("ERR_VIDEO_STITCH", exportException.localizedMessage, exportException)
          }
        }
        val transformer = Transformer.Builder(context).addListener(listener).build()
        activeExports[exportId] = transformer
        transformer.start(composition, outputFile.absolutePath)
      }
    }

    AsyncFunction("prepareRecordingAudio") {
      // VisionCamera configures Android's recording audio source directly.
    }

    AsyncFunction("exportOverlayVideo") {
        inputUri: String,
        audioUri: String?,
        events: List<VideoOverlayEvent>,
        promise: Promise ->
      startOverlayExport(inputUri, audioUri, events, null, null, promise)
    }

    AsyncFunction("exportBrandedOverlayVideo") {
        inputUri: String,
        audioUri: String?,
        events: List<VideoOverlayEvent>,
        headshotUri: String?,
        wordmarkUri: String?,
        promise: Promise ->
      startOverlayExport(inputUri, audioUri, events, headshotUri, wordmarkUri, promise)
    }
  }

  private fun startOverlayExport(
    inputUri: String,
    audioUri: String?,
    events: List<VideoOverlayEvent>,
    headshotUri: String?,
    wordmarkUri: String?,
    promise: Promise
  ) {
    val context = appContext.reactContext?.applicationContext
    if (context == null) {
      promise.reject("ERR_VIDEO_EXPORT", "The Android application context is unavailable.", null)
      return
    }

    Handler(Looper.getMainLooper()).post {
      val exportId = UUID.randomUUID().toString()
      val outputFile = File(context.cacheDir, "whatz-it-overlay-$exportId.mp4")
      val overlay = TimedCardOverlay(events.sortedBy { it.atMs }, headshotUri, wordmarkUri)
      val effects = Effects(
        emptyList<AudioProcessor>(),
        listOf<Effect>(OverlayEffect(listOf(overlay)))
      )
      val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(inputUri)))
        .setEffects(effects)
        .build()

      val listener = object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          activeExports.remove(exportId)
          promise.resolve(Uri.fromFile(outputFile).toString())
        }

        override fun onError(
          composition: Composition,
          exportResult: ExportResult,
          exportException: ExportException
        ) {
          activeExports.remove(exportId)
          outputFile.delete()
          promise.reject("ERR_VIDEO_EXPORT", exportException.localizedMessage, exportException)
        }
      }

      try {
        val transformer = Transformer.Builder(context)
          .addListener(listener)
          .build()
        activeExports[exportId] = transformer
        transformer.start(editedMediaItem, outputFile.absolutePath)
      } catch (error: Exception) {
        activeExports.remove(exportId)
        outputFile.delete()
        promise.reject("ERR_VIDEO_EXPORT", error.localizedMessage, error)
      }
    }
  }
}

@OptIn(UnstableApi::class)
private class TimedCardOverlay(
  private val events: List<VideoOverlayEvent>,
  headshotUri: String?,
  wordmarkUri: String?
) : CanvasOverlay(true) {
  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val answerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = systemTypeface(900)
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

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
    drawBranding(canvas)
    val timeMs = presentationTimeUs / 1_000.0
    val event = events.lastOrNull { it.atMs <= timeMs } ?: return
    val canvasWidth = canvas.width.toFloat()
    val canvasHeight = canvas.height.toFloat()
    val text = event.text.trim().replace(Regex("\\s+"), " ")
    val horizontalPadding = canvasWidth * 0.0198f
    val verticalPadding = canvasHeight * 0.0154f
    val maximumTextWidth = max(1f, canvasWidth - horizontalPadding * 2)
    answerPaint.textSize = canvasHeight * 0.056f
    var answerWidth = answerPaint.measureText(text)
    if (answerWidth > maximumTextWidth) {
      answerPaint.textSize = max(0.1f, answerPaint.textSize * maximumTextWidth / answerWidth)
      answerWidth = answerPaint.measureText(text)
    }
    val timerText = timerTextFor(event, timeMs)
    timerPaint.textSize = canvasHeight * 0.0308f
    val timerWidth = timerText?.let { timerPaint.measureText(it) } ?: 0f
    val minimumWidth = canvasWidth * 0.3f
    val width = min(canvasWidth, max(minimumWidth, max(answerWidth, timerWidth) + horizontalPadding * 2))
    val answerHeight = lineHeight(answerPaint)
    val timerHeight = if (timerText == null) 0f else lineHeight(timerPaint)
    val timerSpacing = if (timerText == null) 0f else canvasHeight * 0.0051f
    val contentHeight = answerHeight + timerSpacing + timerHeight
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
    val answerMetrics = answerPaint.fontMetrics
    val answerBaseline = contentTop - answerMetrics.ascent
    canvas.drawText(text, bounds.centerX(), answerBaseline, answerPaint)
    if (timerText != null) {
      timerPaint.color = colors.second
      val timerMetrics = timerPaint.fontMetrics
      val timerBaseline = contentTop + answerHeight + timerSpacing - timerMetrics.ascent
      canvas.drawText(timerText, bounds.centerX(), timerBaseline, timerPaint)
    }
  }

  private fun timerTextFor(event: VideoOverlayEvent, timeMs: Double): String? {
    val timerEndsAtMs = event.timerEndsAtMs ?: return null
    if (event.kind != "card" && event.kind != "correct" && event.kind != "passed") return null
    val remainingSeconds = max(0, kotlin.math.ceil((timerEndsAtMs - timeMs) / 1_000.0).toInt())
    return "%d:%02d".format(remainingSeconds / 60, remainingSeconds % 60)
  }

  private fun lineHeight(paint: Paint): Float {
    val metrics = paint.fontMetrics
    return metrics.descent - metrics.ascent
  }

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
          margin + (brandingHeight + headshotHeight) / 2f
        ),
        brandingPaint
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
          margin + (brandingHeight + wordmarkHeight) / 2f
        ),
        brandingPaint
      )
    }
  }

  private fun decodeBrandingBitmap(uri: String?): Bitmap? {
    val path = uri?.let { Uri.parse(it) }?.path ?: return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sampleSize = 1
    while (max(bounds.outWidth, bounds.outHeight) / sampleSize > 1_200) sampleSize *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    return BitmapFactory.decodeFile(path, options)
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
