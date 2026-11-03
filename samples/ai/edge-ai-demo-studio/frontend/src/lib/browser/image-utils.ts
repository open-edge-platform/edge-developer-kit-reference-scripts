// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',')
  if (!header || !base64) throw new Error('Not a data URL')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

/** Natural pixel size of an image URL. */
export function loadImageSize(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

/** Resizes a `data:` image URL; returns a JPEG `data:` URL. */
export function resizeImageDataUrl(
  dataUrl: string,
  width: number,
  height: number,
  quality = 0.9,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get 2d canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = dataUrl
  })
}

/** `accept` attribute of the image pickers. */
export const IMAGE_ACCEPT =
  'image/jpeg,image/png,image/bmp,image/tiff,image/webp,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.webp'

/** Largest image the pickers take, in MB. */
export const MAX_IMAGE_MB = 10

export interface ImageFileRules {
  accept?: string
  maxSizeMb?: number
}

/**
 * Checks a picked or dropped file (drops skip the picker's filter) is an image within the size
 * limit. Returns the problem in words, or `null`.
 */
export function validateImageFile(
  file: File,
  { accept = IMAGE_ACCEPT, maxSizeMb = MAX_IMAGE_MB }: ImageFileRules = {},
): string | null {
  const allowed = accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  const dot = file.name.lastIndexOf('.')
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  const type = file.type.toLowerCase()
  const isImage =
    type.startsWith('image/') ||
    allowed.includes(type) ||
    (extension !== '' && allowed.includes(extension))
  if (!isImage) {
    return 'Choose an image file (JPG, PNG, BMP, TIFF or WEBP).'
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `The image is larger than ${maxSizeMb} MB.`
  }
  return null
}
