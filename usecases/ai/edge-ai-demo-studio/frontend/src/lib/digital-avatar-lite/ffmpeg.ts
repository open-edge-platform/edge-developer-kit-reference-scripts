// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * FFmpeg utility functions for video processing
 */

import { spawn } from 'child_process'
import { DEFAULT_FPS, FFMPEG_PATH, FFPROBE_PATH } from './config'
import path from 'path'
import { logger } from '@/utils/logger'

/**
 * Detect the FPS of a video file using ffprobe
 */
export async function detectVideoFPS(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn(FFPROBE_PATH, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=r_frame_rate',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path.normalize(videoPath),
    ])

    let output = ''

    ffprobe.stdout.on('data', (data) => {
      output += data.toString()
    })

    ffprobe.on('close', () => {
      try {
        const [num, den] = output.trim().split('/')
        const fps = Math.round(parseInt(num) / parseInt(den))
        logger.log(`Detected video FPS: ${fps}`)
        resolve(fps)
      } catch {
        logger.warn('Could not detect FPS, using default:', DEFAULT_FPS)
        resolve(DEFAULT_FPS)
      }
    })

    ffprobe.on('error', () => {
      logger.warn('ffprobe error, using default FPS:', DEFAULT_FPS)
      resolve(DEFAULT_FPS)
    })
  })
}

/**
 * Load all frames from video into memory as JPEG buffers
 * This approach provides smooth playback without disk I/O during streaming
 */
export async function loadFrames(videoPath: string): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const frames: Buffer[] = []

    // Use ffmpeg to extract frames as high-quality JPEG
    const ffmpeg = spawn(FFMPEG_PATH, [
      '-i',
      videoPath,
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-q:v',
      '2', // High quality (1-31, lower = better quality)
      '-pix_fmt',
      'yuvj420p', // Ensure proper color space
      '-',
    ])
    let buffer = Buffer.alloc(0)
    const JPEG_SOI = Buffer.from([0xff, 0xd8]) // Start of Image marker
    const JPEG_EOI = Buffer.from([0xff, 0xd9]) // End of Image marker

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])

      // Extract complete JPEG frames from buffer
      let startIdx = 0
      while (true) {
        const soiIdx = buffer.indexOf(JPEG_SOI, startIdx)
        if (soiIdx === -1) break

        const eoiIdx = buffer.indexOf(JPEG_EOI, soiIdx + 2)
        if (eoiIdx === -1) break

        // Extract complete frame
        const frame = buffer.slice(soiIdx, eoiIdx + 2)
        frames.push(frame)

        startIdx = eoiIdx + 2
      }

      // Keep remaining incomplete data in buffer
      buffer = buffer.slice(startIdx)
    })

    ffmpeg.stderr.on('data', (data) => {
      // Log ffmpeg progress/errors if needed
      const message = data.toString()
      if (message.includes('error') || message.includes('Error')) {
        logger.error('ffmpeg error:', message)
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.log(`Loaded ${frames.length} frames into memory`)
        resolve(frames)
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`))
      }
    })

    ffmpeg.on('error', (error) => {
      reject(error)
    })
  })
}
