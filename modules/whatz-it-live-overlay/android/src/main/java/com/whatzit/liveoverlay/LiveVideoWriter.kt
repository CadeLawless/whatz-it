package com.whatzit.liveoverlay

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.SystemClock
import android.view.Surface
import java.io.File
import kotlin.math.max

internal class LiveVideoWriter(
  prefix: String,
  val width: Int,
  val height: Int,
) {
  val file: File = File.createTempFile(prefix, ".mp4")
  var encodedFrameCount: Int = 0
    private set

  private val codec: MediaCodec
  private val inputSurface: Surface
  private val muxer: MediaMuxer
  private val bufferInfo = MediaCodec.BufferInfo()
  private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private var trackIndex = -1
  private var muxerStarted = false
  private var released = false
  private var firstPresentationTimeUs: Long? = null

  init {
    val createdCodec = try {
      MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    } catch (error: Throwable) {
      file.delete()
      throw error
    }
    var createdSurface: Surface? = null
    var createdMuxer: MediaMuxer? = null
    var codecStarted = false
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, TARGET_BIT_RATE)
      setInteger(MediaFormat.KEY_FRAME_RATE, TARGET_FRAME_RATE)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_INTERVAL_SECONDS)
      setInteger(
        MediaFormat.KEY_BITRATE_MODE,
        MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR,
      )
    }
    try {
      createdCodec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      createdSurface = createdCodec.createInputSurface()
      createdCodec.start()
      codecStarted = true
      createdMuxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    } catch (error: Throwable) {
      if (codecStarted) {
        try {
          createdCodec.stop()
        } catch (_: Exception) {
          // The encoder may have failed while starting.
        }
      }
      createdSurface?.release()
      createdCodec.release()
      createdMuxer?.release()
      file.delete()
      throw error
    }
    codec = createdCodec
    inputSurface = checkNotNull(createdSurface)
    muxer = checkNotNull(createdMuxer)
  }

  fun append(bitmap: Bitmap, mirrored: Boolean, drawOverlay: ((Canvas) -> Unit)? = null) {
    check(!released) { "The live video writer has already been released." }
    val canvas = inputSurface.lockHardwareCanvas()
    try {
      canvas.drawColor(Color.BLACK)
      drawCenterCrop(canvas, bitmap, mirrored)
      drawOverlay?.invoke(canvas)
    } finally {
      inputSurface.unlockCanvasAndPost(canvas)
    }
    drain(endOfStream = false)
  }

  fun finish() {
    check(!released) { "The live video writer has already been released." }
    codec.signalEndOfInputStream()
    val deadline = SystemClock.elapsedRealtime() + FINISH_TIMEOUT_MS
    var reachedEnd = false
    while (!reachedEnd && SystemClock.elapsedRealtime() < deadline) {
      reachedEnd = drain(endOfStream = true)
    }
    if (!reachedEnd) {
      cancel()
      throw IllegalStateException("Timed out while finishing the live H.264 encoder.")
    }
    release(deleteOutput = false)
  }

  fun cancel() {
    release(deleteOutput = true)
  }

  private fun drawCenterCrop(canvas: Canvas, bitmap: Bitmap, mirrored: Boolean) {
    val scale = max(width.toFloat() / bitmap.width, height.toFloat() / bitmap.height)
    val renderedWidth = bitmap.width * scale
    val renderedHeight = bitmap.height * scale
    val destination = RectF(
      (width - renderedWidth) / 2f,
      (height - renderedHeight) / 2f,
      (width + renderedWidth) / 2f,
      (height + renderedHeight) / 2f,
    )
    val saveCount = canvas.save()
    if (mirrored) {
      canvas.scale(-1f, 1f, width / 2f, height / 2f)
    }
    canvas.drawBitmap(bitmap, null, destination, bitmapPaint)
    canvas.restoreToCount(saveCount)
  }

  private fun drain(endOfStream: Boolean): Boolean {
    while (true) {
      val outputIndex = codec.dequeueOutputBuffer(
        bufferInfo,
        if (endOfStream) DRAIN_TIMEOUT_US else 0,
      )
      when {
        outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          check(!muxerStarted) { "The encoder output format changed twice." }
          trackIndex = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
        }
        outputIndex >= 0 -> {
          val outputBuffer = codec.getOutputBuffer(outputIndex)
            ?: throw IllegalStateException("The encoded video buffer was unavailable.")
          if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
            bufferInfo.size = 0
          }
          if (bufferInfo.size > 0) {
            check(muxerStarted) { "The encoded video track was unavailable." }
            val firstPresentationTime = firstPresentationTimeUs ?: bufferInfo.presentationTimeUs.also {
              firstPresentationTimeUs = it
            }
            bufferInfo.presentationTimeUs = max(
              0L,
              bufferInfo.presentationTimeUs - firstPresentationTime,
            )
            outputBuffer.position(bufferInfo.offset)
            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
            muxer.writeSampleData(trackIndex, outputBuffer, bufferInfo)
            encodedFrameCount += 1
          }
          val reachedEnd = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(outputIndex, false)
          if (reachedEnd) return true
        }
      }
    }
  }

  private fun release(deleteOutput: Boolean) {
    if (released) {
      if (deleteOutput) file.delete()
      return
    }
    released = true
    try {
      codec.stop()
    } catch (_: Exception) {
      // A failed encoder may already be stopped.
    }
    codec.release()
    inputSurface.release()
    if (muxerStarted) {
      try {
        muxer.stop()
      } catch (_: Exception) {
        // An incomplete track cannot produce a usable MP4.
      }
    }
    muxer.release()
    if (deleteOutput) file.delete()
  }

  private companion object {
    const val TARGET_BIT_RATE = 5_000_000
    const val TARGET_FRAME_RATE = 30
    const val I_FRAME_INTERVAL_SECONDS = 2
    const val DRAIN_TIMEOUT_US = 10_000L
    const val FINISH_TIMEOUT_MS = 5_000L
  }
}
