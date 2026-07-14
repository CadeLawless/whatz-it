package com.whatzit.videoexport

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.CanvasOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
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

@OptimizedRecord
class VideoOverlayEvent(
  @Field val atMs: Double,
  @Field val kind: String,
  @Field val text: String
) : Record

@OptIn(UnstableApi::class)
class WhatzItVideoExportModule : Module() {
  private val activeExports = ConcurrentHashMap<String, Transformer>()

  override fun definition() = ModuleDefinition {
    Name("WhatzItVideoExport")

    AsyncFunction("prepareRecordingAudio") {
      // VisionCamera configures Android's recording audio source directly.
    }

    AsyncFunction("exportOverlayVideo") {
        inputUri: String,
        events: List<VideoOverlayEvent>,
        promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.reject("ERR_VIDEO_EXPORT", "The Android application context is unavailable.", null)
        return@AsyncFunction
      }

      Handler(Looper.getMainLooper()).post {
        val exportId = UUID.randomUUID().toString()
        val outputFile = File(context.cacheDir, "whatz-it-overlay-$exportId.mp4")
        val overlay = TimedCardOverlay(events.sortedBy { it.atMs })
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
}

@OptIn(UnstableApi::class)
private class TimedCardOverlay(
  private val events: List<VideoOverlayEvent>
) : CanvasOverlay(true) {
  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = android.graphics.Typeface.DEFAULT_BOLD
  }

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
    val timeMs = presentationTimeUs / 1_000.0
    val event = events.lastOrNull { it.atMs <= timeMs } ?: return
    val canvasWidth = canvas.width.toFloat()
    val canvasHeight = canvas.height.toFloat()
    val width = canvasWidth * 0.43f
    val height = max(canvasHeight * 0.16f, width * 0.42f)
    val margin = canvasWidth * 0.05f
    val bounds = RectF(margin, canvasHeight - height - margin, margin + width, canvasHeight - margin)
    val colors = colorsFor(event.kind)

    backgroundPaint.color = colors.first
    canvas.drawRoundRect(bounds, width * 0.045f, width * 0.045f, backgroundPaint)

    val horizontalPadding = width * 0.07f
    val textWidth = (width - horizontalPadding * 2).toInt().coerceAtLeast(1)
    textPaint.color = colors.second
    textPaint.textSize = width * 0.09f
    val layout = StaticLayout.Builder.obtain(event.text, 0, event.text.length, textPaint, textWidth)
      .setAlignment(Layout.Alignment.ALIGN_CENTER)
      .setIncludePad(false)
      .setMaxLines(2)
      .setEllipsize(android.text.TextUtils.TruncateAt.END)
      .build()
    val textTop = bounds.top + (height - layout.height) / 2f

    canvas.save()
    canvas.translate(bounds.left + horizontalPadding, textTop)
    layout.draw(canvas)
    canvas.restore()
  }

  private fun colorsFor(kind: String): Pair<Int, Int> = when (kind) {
    "correct" -> Color.argb(199, 135, 237, 170) to Color.rgb(34, 45, 58)
    "passed" -> Color.argb(199, 255, 119, 43) to Color.rgb(82, 38, 8)
    "countdown", "times-up" -> Color.argb(199, 50, 139, 232) to Color.WHITE
    else -> Color.argb(199, 247, 245, 239) to Color.rgb(50, 139, 232)
  }
}
