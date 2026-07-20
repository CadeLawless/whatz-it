package com.whatzit.videoexport

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
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
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

@OptimizedRecord
class VideoOverlayEvent(
  @Field val atMs: Double,
  @Field val kind: String,
  @Field val text: String,
  @Field val byline: String? = null,
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
  private val storageCleanupCutoffMs = System.currentTimeMillis() - 2_000

  override fun definition() = ModuleDefinition {
    Name("WhatzItVideoExport")

    AsyncFunction("performVideoStorageMaintenance") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction emptyMap<String, Long>()
      val before = readStorageDiagnostics(context)
      val cleanup = cleanupPreviousSessionTemporaryFiles(context, storageCleanupCutoffMs)
      val after = readStorageDiagnostics(context)
      mapOf(
        "afterApplicationSupportBytes" to after.applicationSupportBytes,
        "afterCachesBytes" to after.cachesBytes,
        "afterDocumentsBytes" to after.documentsBytes,
        "afterLibraryBytes" to after.libraryBytes,
        "afterTemporaryBytes" to after.temporaryBytes,
        "afterTotalBytes" to after.totalBytes,
        "beforeApplicationSupportBytes" to before.applicationSupportBytes,
        "beforeCachesBytes" to before.cachesBytes,
        "beforeDocumentsBytes" to before.documentsBytes,
        "beforeLibraryBytes" to before.libraryBytes,
        "beforeTemporaryBytes" to before.temporaryBytes,
        "beforeTotalBytes" to before.totalBytes,
        "deletedBytes" to cleanup.deletedBytes,
        "deletedFiles" to cleanup.deletedFiles,
      )
    }

    AsyncFunction("stitchRoundVideoSegments") {
        segments: List<RoundVideoSegment>,
        promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null || segments.isEmpty()) {
        promise.reject("ERR_VIDEO_STITCH", "No application context or video segments are available.", null)
        return@AsyncFunction
      }
      Handler(Looper.getMainLooper()).post {
        val operationStartedAt = SystemClock.elapsedRealtime()
        val exportId = UUID.randomUUID().toString()
        val outputFile = File(context.cacheDir, "whatz-it-stitched-$exportId.mp4")
        val items = segments.map {
          EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(it.videoUri))).build()
        }
        val sequence = EditedMediaItemSequence.withAudioAndVideoFrom(items)
        val composition = Composition.Builder(listOf(sequence)).build()
        Log.i(
          "RoundVideoNative",
          "Segment stitch started id=$exportId segmentCount=${segments.size}"
        )
        val listener = object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            activeExports.remove(exportId)
            Log.i(
              "RoundVideoNative",
              "Segment stitch completed id=$exportId elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt} outputBytes=${outputFile.length()}"
            )
            promise.resolve(Uri.fromFile(outputFile).toString())
          }

          override fun onError(
            composition: Composition,
            exportResult: ExportResult,
            exportException: ExportException
          ) {
            activeExports.remove(exportId)
            Log.e(
              "RoundVideoNative",
              "Segment stitch failed id=$exportId elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt}",
              exportException
            )
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

    AsyncFunction("muxLiveOverlayVideo") {
        videoUri: String,
        audioUri: String?,
        microphoneOffsetMs: Double,
        promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.reject("ERR_LIVE_VIDEO_MUX", "The Android application context is unavailable.", null)
        return@AsyncFunction
      }
      Thread {
        val operationStartedAt = SystemClock.elapsedRealtime()
        val outputFile = File(context.cacheDir, "whatz-it-live-ready-${UUID.randomUUID()}.mp4")
        try {
          muxVideoAndAudio(
            context,
            Uri.parse(videoUri),
            audioUri?.let(Uri::parse),
            (max(0.0, microphoneOffsetMs) * 1_000.0).toLong(),
            outputFile,
          )
          Log.i(
            "RoundVideoNative",
            "Android live overlay mux completed elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt} outputBytes=${outputFile.length()}",
          )
          promise.resolve(Uri.fromFile(outputFile).toString())
        } catch (error: Exception) {
          outputFile.delete()
          Log.e(
            "RoundVideoNative",
            "Android live overlay mux failed elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt}",
            error,
          )
          promise.reject("ERR_LIVE_VIDEO_MUX", error.localizedMessage, error)
        }
      }.start()
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
      val operationStartedAt = SystemClock.elapsedRealtime()
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
      Log.i(
        "RoundVideoNative",
        "Overlay export started id=$exportId eventCount=${events.size} hasSeparateAudio=${audioUri != null} inputBytes=${fileSize(inputUri)}"
      )

      val listener = object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          activeExports.remove(exportId)
          Log.i(
            "RoundVideoNative",
            "Overlay export completed id=$exportId elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt} outputBytes=${outputFile.length()}"
          )
          promise.resolve(Uri.fromFile(outputFile).toString())
        }

        override fun onError(
          composition: Composition,
          exportResult: ExportResult,
          exportException: ExportException
        ) {
          activeExports.remove(exportId)
          Log.e(
            "RoundVideoNative",
            "Overlay export failed id=$exportId elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt}",
            exportException
          )
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
        Log.e(
          "RoundVideoNative",
          "Overlay export failed before start id=$exportId elapsedMs=${SystemClock.elapsedRealtime() - operationStartedAt}",
          error
        )
        outputFile.delete()
        promise.reject("ERR_VIDEO_EXPORT", error.localizedMessage, error)
      }
    }
  }

  private fun fileSize(uri: String): Long {
    val parsed = Uri.parse(uri)
    return if (parsed.scheme == "file") File(parsed.path.orEmpty()).length() else 0
  }

  private data class StorageDiagnostics(
    val applicationSupportBytes: Long,
    val cachesBytes: Long,
    val documentsBytes: Long,
    val libraryBytes: Long,
    val temporaryBytes: Long,
    val totalBytes: Long,
  )

  private data class StorageCleanupResult(
    var deletedBytes: Long = 0,
    var deletedFiles: Long = 0,
  )

  private fun readStorageDiagnostics(context: android.content.Context): StorageDiagnostics {
    val dataDirectory = File(context.applicationInfo.dataDir)
    val temporaryDirectory = System.getProperty("java.io.tmpdir")?.let(::File)
    return StorageDiagnostics(
      applicationSupportBytes = allocatedSize(context.filesDir),
      cachesBytes = allocatedSize(context.cacheDir),
      documentsBytes = allocatedSize(context.filesDir),
      libraryBytes = allocatedSize(dataDirectory),
      temporaryBytes = temporaryDirectory?.let(::allocatedSize) ?: 0,
      totalBytes = allocatedSize(dataDirectory),
    )
  }

  private fun cleanupPreviousSessionTemporaryFiles(
    context: android.content.Context,
    cutoffMs: Long,
  ): StorageCleanupResult {
    val result = StorageCleanupResult()
    val prefixes = listOf("VisionCamera_", "whatz-it-")
    val temporaryDirectories = linkedSetOf(context.cacheDir)
    System.getProperty("java.io.tmpdir")?.let { temporaryDirectories.add(File(it)) }

    temporaryDirectories.forEach { directory ->
      directory.listFiles().orEmpty().forEach { file ->
        if (
          file.isFile &&
          file.lastModified() in 1L until cutoffMs &&
          prefixes.any { prefix -> file.name.startsWith(prefix) }
        ) {
          deleteTemporaryEntry(file, result)
        }
      }
    }

    val expoAudioDirectory = File(context.cacheDir, "Audio")
    expoAudioDirectory.listFiles().orEmpty().forEach { file ->
      if (file.lastModified() in 1L until cutoffMs) deleteTemporaryEntry(file, result)
    }
    return result
  }

  private fun deleteTemporaryEntry(file: File, result: StorageCleanupResult) {
    val deletedBytes = allocatedSize(file)
    val deletedFiles = regularFileCount(file)
    if (file.deleteRecursively()) {
      result.deletedBytes += deletedBytes
      result.deletedFiles += deletedFiles
    } else {
      Log.w("RoundVideoNative", "Previous-session temporary cleanup failed file=${file.name}")
    }
  }

  private fun allocatedSize(file: File): Long {
    if (!file.exists()) return 0
    if (file.isFile) return file.length()
    return file.listFiles().orEmpty().sumOf(::allocatedSize)
  }

  private fun regularFileCount(file: File): Long {
    if (!file.exists()) return 0
    if (file.isFile) return 1
    return file.listFiles().orEmpty().sumOf(::regularFileCount)
  }

  private fun muxVideoAndAudio(
    context: android.content.Context,
    videoUri: Uri,
    audioUri: Uri?,
    audioOffsetUs: Long,
    outputFile: File,
  ) {
    val videoExtractor = MediaExtractor()
    val audioExtractor = audioUri?.let { MediaExtractor() }
    var muxer: MediaMuxer? = null
    var muxerStarted = false
    try {
      videoExtractor.setDataSource(context, videoUri, null)
      val videoTrack = findTrack(videoExtractor, "video/")
      check(videoTrack >= 0) { "The live recording has no video track." }
      val videoFormat = videoExtractor.getTrackFormat(videoTrack)
      val videoDurationUs = if (videoFormat.containsKey(MediaFormat.KEY_DURATION)) {
        videoFormat.getLong(MediaFormat.KEY_DURATION)
      } else {
        Long.MAX_VALUE
      }

      val audioTrack = if (audioExtractor != null && audioUri != null) {
        audioExtractor.setDataSource(context, audioUri, null)
        findTrack(audioExtractor, "audio/")
      } else {
        -1
      }
      if (audioExtractor != null) check(audioTrack >= 0) { "The microphone recording has no audio track." }

      muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      if (videoFormat.containsKey(MediaFormat.KEY_ROTATION)) {
        muxer.setOrientationHint(videoFormat.getInteger(MediaFormat.KEY_ROTATION))
      }
      val outputVideoTrack = muxer.addTrack(videoFormat)
      val outputAudioTrack = if (audioExtractor != null) {
        muxer.addTrack(audioExtractor.getTrackFormat(audioTrack))
      } else {
        -1
      }
      muxer.start()
      muxerStarted = true

      copyTrack(videoExtractor, videoTrack, muxer, outputVideoTrack, 0L, videoDurationUs)
      if (audioExtractor != null) {
        copyTrack(
          audioExtractor,
          audioTrack,
          muxer,
          outputAudioTrack,
          audioOffsetUs,
          videoDurationUs,
        )
      }
    } finally {
      videoExtractor.release()
      audioExtractor?.release()
      if (muxerStarted) muxer?.stop()
      muxer?.release()
    }
  }

  private fun findTrack(extractor: MediaExtractor, mimePrefix: String): Int {
    for (index in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)
      if (mime?.startsWith(mimePrefix) == true) return index
    }
    return -1
  }

  private fun copyTrack(
    extractor: MediaExtractor,
    inputTrack: Int,
    muxer: MediaMuxer,
    outputTrack: Int,
    presentationOffsetUs: Long,
    maximumPresentationTimeUs: Long,
  ) {
    extractor.selectTrack(inputTrack)
    extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
    val format = extractor.getTrackFormat(inputTrack)
    val maximumInputSize = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
      max(DEFAULT_MUX_BUFFER_SIZE, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
    } else {
      DEFAULT_MUX_BUFFER_SIZE
    }
    val buffer = ByteBuffer.allocateDirect(maximumInputSize)
    val info = MediaCodec.BufferInfo()
    var firstSampleTimeUs = -1L
    while (true) {
      val sampleTimeUs = extractor.sampleTime
      if (sampleTimeUs < 0) break
      if (firstSampleTimeUs < 0) firstSampleTimeUs = sampleTimeUs
      val outputTimeUs = sampleTimeUs - firstSampleTimeUs + presentationOffsetUs
      if (outputTimeUs > maximumPresentationTimeUs) break
      buffer.clear()
      val size = extractor.readSampleData(buffer, 0)
      if (size < 0) break
      val outputFlags = if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
        MediaCodec.BUFFER_FLAG_KEY_FRAME
      } else {
        0
      }
      info.set(0, size, outputTimeUs, outputFlags)
      muxer.writeSampleData(outputTrack, buffer, info)
      extractor.advance()
    }
    extractor.unselectTrack(inputTrack)
  }

  private companion object {
    const val DEFAULT_MUX_BUFFER_SIZE = 2 * 1024 * 1024
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

  override fun onDraw(canvas: Canvas, presentationTimeUs: Long) {
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
    drawBranding(canvas)
    val timeMs = presentationTimeUs / 1_000.0
    val event = events.lastOrNull { it.atMs <= timeMs } ?: return
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
    val timerText = timerTextFor(event, timeMs)
    timerPaint.textSize = canvasHeight * 0.0308f
    val timerWidth = timerText?.let { timerPaint.measureText(it) } ?: 0f
    val minimumWidth = canvasWidth * 0.3f
    val width = min(
      canvasWidth,
      max(minimumWidth, max(answerWidth, max(bylineWidth, timerWidth)) + horizontalPadding * 2)
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
    val answerMetrics = answerPaint.fontMetrics
    val answerBaseline = contentTop - answerMetrics.ascent
    canvas.drawText(text, bounds.centerX(), answerBaseline, answerPaint)
    if (byline != null) {
      bylinePaint.color = colors.second
      bylinePaint.alpha = 184
      val bylineMetrics = bylinePaint.fontMetrics
      val bylineBaseline = contentTop + answerHeight + bylineSpacing - bylineMetrics.ascent
      canvas.drawText(byline, bounds.centerX(), bylineBaseline, bylinePaint)
    }
    if (timerText != null) {
      timerPaint.color = colors.second
      val timerMetrics = timerPaint.fontMetrics
      val timerBaseline = contentTop + answerHeight + bylineSpacing + bylineHeight + timerSpacing - timerMetrics.ascent
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
