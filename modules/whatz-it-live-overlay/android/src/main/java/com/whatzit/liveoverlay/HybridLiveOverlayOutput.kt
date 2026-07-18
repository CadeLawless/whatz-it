package com.whatzit.liveoverlay

import android.net.Uri
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import com.margelo.nitro.camera.CameraOrientation
import com.margelo.nitro.camera.HybridCameraOutputSpec
import com.margelo.nitro.camera.MediaType
import com.margelo.nitro.camera.MirrorMode
import com.margelo.nitro.camera.Size
import com.margelo.nitro.camera.extensions.surfaceRotation
import com.margelo.nitro.camera.public.NativeCameraOutput
import com.margelo.nitro.core.Promise
import com.margelo.nitro.whatzit.liveoverlay.LiveOverlayEvent
import com.margelo.nitro.whatzit.liveoverlay.LiveOverlayRecordingResult
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max

internal class HybridLiveOverlayOutput : HybridCameraOutputSpec(), NativeCameraOutput {
  private val encoderExecutor: ExecutorService =
    Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "whatz-it-live-overlay") }

  @Volatile
  private var recordingRequested = false
  private var imageAnalysis: ImageAnalysis? = null
  private var resolvedMirrorMode: MirrorMode = MirrorMode.OFF
  private var cleanVideoWriter: LiveVideoWriter? = null
  private var brandedVideoWriter: LiveVideoWriter? = null
  private var renderer: LiveOverlayRenderer? = null
  private var events: List<LiveOverlayEvent> = emptyList()
  private var firstTimestampNs: Long? = null
  private var lastTimestampNs: Long? = null
  private var droppedFrameCount = 0
  private var outputWidth = 0
  private var outputHeight = 0
  private var recordingFailure: Throwable? = null

  override val mediaType: MediaType = MediaType.VIDEO
  override var outputOrientation: CameraOrientation = CameraOrientation.UP
    set(value) {
      field = value
      imageAnalysis?.targetRotation = value.surfaceRotation
    }
  override val currentResolution: Size?
    get() = imageAnalysis?.resolutionInfo?.resolution?.let {
      Size(it.width.toDouble(), it.height.toDouble())
    }
  override val mirrorMode: MirrorMode
    get() = resolvedMirrorMode

  val isRecording: Boolean
    get() = recordingRequested

  override fun createUseCase(
    mirrorMode: MirrorMode,
    config: NativeCameraOutput.Config,
  ): NativeCameraOutput.PreparedUseCase {
    val resolutionSelector = ResolutionSelector.Builder()
      .setResolutionFilter { sizes, _ ->
        sizes.sortedBy { size ->
          minOf(
            abs(size.width - TARGET_LONG_EDGE) + abs(size.height - TARGET_SHORT_EDGE),
            abs(size.width - TARGET_SHORT_EDGE) + abs(size.height - TARGET_LONG_EDGE),
          )
        }
      }
      .build()
    val analysis = ImageAnalysis.Builder()
      .setResolutionSelector(resolutionSelector)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_BLOCK_PRODUCER)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .setOutputImageRotationEnabled(true)
      .setTargetRotation(outputOrientation.surfaceRotation)
      .setBackgroundExecutor(encoderExecutor)
      .build()

    return NativeCameraOutput.PreparedUseCase(analysis) {
      imageAnalysis?.clearAnalyzer()
      imageAnalysis = analysis
      resolvedMirrorMode = mirrorMode
      analysis.setAnalyzer(encoderExecutor, ::processFrame)
    }
  }

  fun startRecording(headshotUri: String?, wordmarkUri: String?): Promise<Unit> = Promise.async {
    runOnEncoderThread {
      check(!recordingRequested) { "A live-overlay recording is already active." }
      resetRecordingState(deleteOutputs = true)
      renderer = LiveOverlayRenderer(headshotUri, wordmarkUri)
      recordingRequested = true
      Log.i(
        TAG,
        "Android live overlay recorder armed headshot=${headshotUri != null} wordmark=${wordmarkUri != null}",
      )
    }
  }

  fun appendOverlayEvent(event: LiveOverlayEvent) {
    encoderExecutor.execute {
      if (!recordingRequested) return@execute
      events = (events + event).sortedBy { it.atMs }
    }
  }

  fun stopRecording(): Promise<LiveOverlayRecordingResult> {
    val wasRecording = recordingRequested
    recordingRequested = false
    return Promise.async {
      runOnEncoderThread {
        if (!wasRecording) {
          val error = recordingFailure
            ?: IllegalStateException("No Android live-overlay recording is active.")
          resetRecordingState(deleteOutputs = true)
          throw error
        }
        finishRecording()
      }
    }
  }

  fun cancelRecording(): Promise<Unit> {
    recordingRequested = false
    return Promise.async {
      runOnEncoderThread { resetRecordingState(deleteOutputs = true) }
    }
  }

  private fun processFrame(image: ImageProxy) {
    try {
      if (!recordingRequested) return
      val bitmap = image.toBitmap()
      try {
        val timestampNs = image.imageInfo.timestamp
        if (cleanVideoWriter == null || brandedVideoWriter == null) {
          initializeWriters(bitmap.width, bitmap.height, timestampNs)
        }
        val cleanWriter = cleanVideoWriter
          ?: throw IllegalStateException("The clean Android live writer is unavailable.")
        val brandedWriter = brandedVideoWriter
          ?: throw IllegalStateException("The branded Android live writer is unavailable.")
        val elapsedMs = max(0.0, (timestampNs - (firstTimestampNs ?: timestampNs)) / 1_000_000.0)
        val event = events.lastOrNull { it.atMs <= elapsedMs }
        val mirrored = resolvedMirrorMode == MirrorMode.ON
        cleanWriter.append(bitmap, mirrored)
        brandedWriter.append(bitmap, mirrored) { canvas ->
          renderer?.draw(canvas, event, elapsedMs)
        }
        lastTimestampNs = timestampNs
      } finally {
        bitmap.recycle()
      }
    } catch (error: Throwable) {
      droppedFrameCount += 1
      recordingFailure = error
      recordingRequested = false
      cleanVideoWriter?.cancel()
      brandedVideoWriter?.cancel()
      Log.e(TAG, "Android live overlay frame processing failed", error)
    } finally {
      image.close()
    }
  }

  private fun initializeWriters(sourceWidth: Int, sourceHeight: Int, timestampNs: Long) {
    if (sourceWidth >= sourceHeight) {
      outputWidth = TARGET_LONG_EDGE
      outputHeight = TARGET_SHORT_EDGE
    } else {
      outputWidth = TARGET_SHORT_EDGE
      outputHeight = TARGET_LONG_EDGE
    }
    val cleanWriter = LiveVideoWriter("whatz-it-live-clean-", outputWidth, outputHeight)
    val brandedWriter = try {
      LiveVideoWriter("whatz-it-live-branded-", outputWidth, outputHeight)
    } catch (error: Throwable) {
      cleanWriter.cancel()
      throw error
    }
    cleanVideoWriter = cleanWriter
    brandedVideoWriter = brandedWriter
    firstTimestampNs = timestampNs
    lastTimestampNs = timestampNs
    Log.i(
      TAG,
      "Android dual live writers started width=$outputWidth height=$outputHeight sourceWidth=$sourceWidth sourceHeight=$sourceHeight clean=${cleanWriter.file.name} branded=${brandedWriter.file.name}",
    )
  }

  private fun finishRecording(): LiveOverlayRecordingResult {
    val cleanWriter = cleanVideoWriter
      ?: throw IllegalStateException("The Android live-overlay recorder received no frames.")
    val brandedWriter = brandedVideoWriter
      ?: throw IllegalStateException("The Android live-overlay recorder received no frames.")
    val firstTimestamp = firstTimestampNs
      ?: throw IllegalStateException("The Android live-overlay recorder received no frames.")
    val lastTimestamp = lastTimestampNs
      ?: throw IllegalStateException("The Android live-overlay recorder received no frames.")
    try {
      cleanWriter.finish()
      brandedWriter.finish()
      check(cleanWriter.encodedFrameCount > 0 && brandedWriter.encodedFrameCount > 0) {
        "The Android live-overlay encoders produced no frames."
      }
      val durationMs = max(0.0, (lastTimestamp - firstTimestamp) / 1_000_000.0)
      val result = LiveOverlayRecordingResult(
        cleanUri = Uri.fromFile(cleanWriter.file).toString(),
        uri = Uri.fromFile(brandedWriter.file).toString(),
        durationMs = durationMs,
        encodedFrameCount = brandedWriter.encodedFrameCount.toDouble(),
        droppedFrameCount = droppedFrameCount.toDouble(),
        width = outputWidth.toDouble(),
        height = outputHeight.toDouble(),
      )
      Log.i(
        TAG,
        "Android dual live recorder completed durationMs=$durationMs cleanFrames=${cleanWriter.encodedFrameCount} brandedFrames=${brandedWriter.encodedFrameCount} droppedFrames=$droppedFrameCount width=$outputWidth height=$outputHeight",
      )
      resetRecordingState(deleteOutputs = false)
      return result
    } catch (error: Throwable) {
      cleanWriter.cancel()
      brandedWriter.cancel()
      resetRecordingState(deleteOutputs = true)
      throw error
    }
  }

  private fun resetRecordingState(deleteOutputs: Boolean) {
    if (deleteOutputs) {
      cleanVideoWriter?.cancel()
      brandedVideoWriter?.cancel()
    }
    cleanVideoWriter = null
    brandedVideoWriter = null
    renderer?.recycle()
    renderer = null
    events = emptyList()
    firstTimestampNs = null
    lastTimestampNs = null
    droppedFrameCount = 0
    outputWidth = 0
    outputHeight = 0
    recordingFailure = null
  }

  private fun <T> runOnEncoderThread(block: () -> T): T =
    encoderExecutor.submit(Callable { block() }).get()

  override fun dispose() {
    recordingRequested = false
    try {
      runOnEncoderThread {
        imageAnalysis?.clearAnalyzer()
        imageAnalysis = null
        resetRecordingState(deleteOutputs = true)
      }
    } finally {
      encoderExecutor.shutdown()
      super.dispose()
    }
  }

  private companion object {
    const val TAG = "RoundVideoNative"
    const val TARGET_LONG_EDGE = 1280
    const val TARGET_SHORT_EDGE = 720
  }
}
