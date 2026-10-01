package com.whatzit.videoexport

import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise

/** Decode once before the round; play never seeks or waits for the UI thread. */
internal class AndroidRoundSounds {
  private val handler = Handler(Looper.getMainLooper())
  private val pool = SoundPool.Builder().setMaxStreams(8).setAudioAttributes(
    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
  ).build()
  private val samples = mutableMapOf<String, Int>()
  private val loaded = mutableSetOf<Int>()
  private val streams = mutableMapOf<String, MutableList<Int>>()
  private val pending = mutableListOf<Promise>()
  private var released = false
  private val timeout = Runnable { synchronized(this) { finishLoading(false) } }

  init {
    pool.setOnLoadCompleteListener { _, id, status ->
      synchronized(this) {
        if (released || id !in samples.values) return@setOnLoadCompleteListener
        if (status != 0) finishLoading(false)
        else {
          loaded.add(id)
          if (samples.isNotEmpty() && samples.values.all { it in loaded }) finishLoading(true)
        }
      }
    }
  }

  fun prepare(sounds: Map<String, String>, promise: Promise) {
    handler.post {
      synchronized(this) {
        if (released) { promise.resolve(false); return@post }
        if (sounds.isEmpty()) { promise.resolve(false); return@post }
        pending.add(promise)
        try {
          sounds.forEach { (sound, uri) ->
            if (sound !in samples) {
              val path = Uri.parse(uri).path ?: error("Missing round sound path")
              val id = pool.load(path, 1)
              check(id != 0) { "Cannot load round sound: $sound" }
              samples[sound] = id
            }
          }
          if (samples.values.all { it in loaded }) finishLoading(true)
          else {
            handler.removeCallbacks(timeout)
            handler.postDelayed(timeout, 5000)
          }
        } catch (_: Exception) { finishLoading(false) }
      }
    }
  }

  @Synchronized fun play(sound: String, volume: Double): Boolean {
    if (released) return false
    val sample = samples[sound] ?: return false
    if (sample !in loaded) return false
    // Restart repeated answers rather than layering the same cue. Clock ticks
    // may overlap because their audio tail lasts slightly longer than a second.
    val previous = streams.getOrPut(sound) { mutableListOf() }
    if (sound != "final-tick") previous.forEach { pool.stop(it) }
    while (previous.size >= 2) pool.stop(previous.removeAt(0))
    val level = volume.coerceIn(0.0, 1.0).toFloat()
    val stream = pool.play(sample, level, level, 1, 0, 1f)
    if (stream == 0) return false
    previous.add(stream)
    return true
  }

  @Synchronized fun stop(introOnly: Boolean = false) {
    streams.entries.removeAll { (sound, active) ->
      val stop = !introOnly || sound in listOf("get-ready", "count-3", "count-2", "count-1")
      if (stop) active.forEach { pool.stop(it) }
      stop
    }
  }

  @Synchronized fun release() {
    stop()
    released = true
    finishLoading(false)
    pool.release()
  }

  private fun finishLoading(success: Boolean) {
    handler.removeCallbacks(timeout)
    val requests = pending.toList()
    pending.clear()
    if (!success) {
      samples.values.forEach { pool.unload(it) }
      samples.clear()
      loaded.clear()
    }
    requests.forEach { it.resolve(success) }
  }
}
