// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  ImagePlus,
  Loader2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useImagePreviewUrl } from '@/hooks/use-image-preview-url'
import { cn } from '@/lib/utils'
import {
  useClearGallery,
  useDeletePerson,
  useEnroll,
  useGallery,
  type EnrollFileStatus,
} from '../hooks'

function PersonThumbnail({
  url,
  alt,
  className,
}: {
  url: string
  alt: string
  className?: string
}) {
  const { previewUrl } = useImagePreviewUrl(url)
  if (!previewUrl) return null
  return (
    <Image
      src={previewUrl}
      alt={alt}
      width={36}
      height={36}
      unoptimized
      className={className}
    />
  )
}

const ACCEPT = '.jpg,.jpeg,.png,.bmp,.tiff,.webp'
const MAX_BYTES = 10 * 1024 * 1024

/** Reference-gallery panel: enroll persons and manage who is enrolled. */
export function FaceGalleryPanel({ isOnline }: { isOnline: boolean }) {
  const gallery = useGallery(isOnline)
  const enroll = useEnroll()
  const deletePerson = useDeletePerson()
  const clearGallery = useClearGallery()

  const [name, setName] = useState('')
  const [pending, setPending] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [lastEnrollFiles, setLastEnrollFiles] = useState<EnrollFileStatus[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setFileError(null)
    const accepted: File[] = []
    for (const file of Array.from(incoming)) {
      if (!file.type.startsWith('image/')) {
        setFileError(`${file.name}: not an image file`)
        continue
      }
      if (file.size > MAX_BYTES) {
        setFileError(`${file.name}: larger than 10MB`)
        continue
      }
      accepted.push(file)
    }
    if (accepted.length) setPending((prev) => [...prev, ...accepted])
  }, [])

  const handleEnroll = () => {
    if (!name.trim() || pending.length === 0) return
    enroll.mutate(
      { name: name.trim(), files: pending },
      {
        onSuccess: (data) => {
          setName('')
          setPending([])
          setLastEnrollFiles(data.files.filter((f) => f.error))
        },
      },
    )
  }

  const persons = gallery.data?.persons ?? []

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Reference Gallery
        </CardTitle>
        <CardDescription>
          Enroll each person with one or more reference photos. The largest face
          in each photo is embedded by the active model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Enroll form ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label
            htmlFor="face-person-name"
            className="text-muted-foreground text-xs"
          >
            Person name
          </Label>
          <Input
            id="face-person-name"
            data-testid="face-person-name"
            placeholder="e.g. Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOnline || enroll.isPending}
          />
        </div>

        <div
          data-testid="face-reference-drop-zone"
          onDragEnter={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault()
            setIsDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
            (!isOnline || enroll.isPending) && 'pointer-events-none opacity-50',
          )}
        >
          <input
            ref={inputRef}
            data-testid="face-reference-input"
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <ImagePlus className="text-muted-foreground mx-auto mb-1 h-5 w-5" />
          <p className="text-xs font-medium">Drop reference photo(s)</p>
          <p className="text-muted-foreground text-[10px]">
            or click to browse — multiple images improve matching
          </p>
        </div>

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((file, i) => (
              <Badge
                key={`${file.name}-${i}`}
                variant="secondary"
                className="gap-1"
              >
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPending((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {(fileError || enroll.error) && (
          <p className="text-destructive flex items-center gap-1.5 text-xs">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {fileError ?? enroll.error?.message}
          </p>
        )}
        {lastEnrollFiles.map((f) => (
          <p
            key={f.file}
            className="text-destructive flex items-center gap-1.5 text-xs"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {f.file}: {f.error}
          </p>
        ))}

        <Button
          data-testid="face-enroll-button"
          onClick={handleEnroll}
          disabled={
            !isOnline ||
            !name.trim() ||
            pending.length === 0 ||
            enroll.isPending
          }
          className="w-full"
        >
          {enroll.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          {enroll.isPending ? 'Enrolling…' : 'Enroll Person'}
        </Button>

        <Separator />

        {/* ── Enrolled persons ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Enrolled ({persons.length})</p>
          {persons.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearGallery.mutate()}
              disabled={clearGallery.isPending}
            >
              Clear all
            </Button>
          )}
        </div>
        {persons.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No one enrolled yet. Faces in the probe image will show as
            “Unknown”.
          </p>
        ) : (
          <ul className="space-y-2">
            {persons.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 rounded-lg border p-2"
              >
                <div className="flex shrink-0 -space-x-2">
                  {person.thumbnails.slice(0, 3).map((thumb, i) => (
                    <PersonThumbnail
                      key={i}
                      url={thumb}
                      alt={`${person.name} reference ${i + 1}`}
                      className="border-background h-9 w-9 rounded-full border-2 object-cover"
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {person.num_images} image
                    {person.num_images === 1 ? '' : 's'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${person.name}`}
                  onClick={() => deletePerson.mutate(person.id)}
                  disabled={deletePerson.isPending}
                >
                  <Trash2 className="text-destructive h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
