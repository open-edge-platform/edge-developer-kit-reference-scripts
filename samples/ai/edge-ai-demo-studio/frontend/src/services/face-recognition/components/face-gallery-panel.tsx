// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircle,
  ImagePlus,
  Loader,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { FileDropTarget } from '@/components/common/file-drop-target'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefImage } from '@/components/common/ref-media'
import { TruncatedText } from '@/components/common/truncated-text'
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
import { plural } from '@/lib/browser/format'
import { IMAGE_ACCEPT, validateImageFile } from '@/lib/browser/image-utils'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'
import {
  type EnrollFileStatus,
  type GalleryPerson,
  useClearGallery,
  useDeletePerson,
  useEnroll,
  useGallery,
} from '../hooks'

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <InlineNotice
      tone="destructive"
      size="sm"
      icon={<AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
    >
      {children}
    </InlineNotice>
  )
}

/** What is being removed from the gallery, waiting for a confirmation. */
type PendingRemoval =
  { kind: 'person'; person: GalleryPerson } | { kind: 'all' }

/** Step 1: enroll people from reference photos. Recognition can only name people enrolled here. */
export function FaceGalleryPanel({ apiBase }: { apiBase: string | undefined }) {
  const gallery = useGallery(apiBase)
  const enroll = useEnroll(apiBase)
  const { mutateAsync: deletePerson } = useDeletePerson(apiBase)
  const { mutateAsync: clearGallery } = useClearGallery(apiBase)

  const [name, setName] = useState('')
  const [pending, setPending] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [lastEnrollFiles, setLastEnrollFiles] = useState<EnrollFileStatus[]>([])
  const [removal, setRemoval] = useState<PendingRemoval | null>(null)

  const addFiles = (incoming: File[]) => {
    setFileError(null)
    const accepted: File[] = []
    for (const file of incoming) {
      const problem = validateImageFile(file)
      if (problem) {
        setFileError(`${file.name}: ${problem}`)
        continue
      }
      accepted.push(file)
    }
    if (accepted.length) setPending((prev) => [...prev, ...accepted])
  }

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

  const confirmRemoval = async () => {
    if (removal?.kind === 'person') await deletePerson(removal.person.id)
    else if (removal?.kind === 'all') await clearGallery()
  }

  const persons = gallery.data?.persons ?? []
  // Nothing is known about who is enrolled: say so rather than "no one".
  const galleryUnavailable = gallery.isError && !gallery.data

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">
          <h3
            className="flex items-center gap-2"
            data-testid="face-step-enroll"
          >
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
            >
              1
            </span>
            <span>
              <span className="sr-only">Step 1: </span>
              Enroll people
            </span>
            <Users
              aria-hidden="true"
              className="text-muted-foreground h-4 w-4"
            />
          </h3>
        </CardTitle>
        <CardDescription className="text-xs">
          Build the reference gallery: a name and one or more photos per person.
          The largest face in each photo is embedded by the active model.
          Recognition can only name people enrolled here. The gallery lives in
          the running instance and is empty again after a restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            disabled={enroll.isPending}
          />
        </div>

        <FileDropTarget
          onFiles={addFiles}
          accept={IMAGE_ACCEPT}
          multiple
          disabled={enroll.isPending}
          testId="face-reference-drop-zone"
          inputTestId="face-reference-input"
          aria-label="Add reference photos"
          className="rounded-lg p-4"
        >
          <ImagePlus
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-1 h-5 w-5"
          />
          <p className="text-xs font-medium">Drop reference photo(s)</p>
          <p className="text-muted-foreground text-xs">
            or click to browse — multiple images improve matching
          </p>
        </FileDropTarget>

        {pending.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Photos to enroll">
            {pending.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="bg-secondary text-secondary-foreground flex max-w-full items-center gap-0.5 rounded-md pl-2 text-xs"
              >
                <TruncatedText text={file.name} className="max-w-[160px]" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPending((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {(fileError || enroll.error) && (
          <ErrorLine>{fileError ?? enroll.error?.message}</ErrorLine>
        )}
        {lastEnrollFiles.map((f) => (
          <ErrorLine key={f.file}>
            {f.file}: {f.error}
          </ErrorLine>
        ))}

        <Button
          data-testid="face-enroll-button"
          onClick={handleEnroll}
          disabled={!name.trim() || pending.length === 0 || enroll.isPending}
          className="w-full"
        >
          {enroll.isPending ? (
            <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus aria-hidden="true" className="h-4 w-4" />
          )}
          {enroll.isPending ? 'Enrolling…' : 'Enroll Person'}
        </Button>

        <Separator />

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Enrolled{galleryUnavailable ? '' : ` (${persons.length})`}
          </p>
          {persons.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRemoval({ kind: 'all' })}
            >
              Clear all
            </Button>
          )}
        </div>
        {gallery.isError && (
          <div className="flex items-center justify-between gap-2">
            <ErrorLine>
              {galleryUnavailable
                ? 'Unable to load the gallery: '
                : 'Unable to refresh the gallery: '}
              {gallery.error.message}
            </ErrorLine>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => gallery.refetch()}
              disabled={gallery.isFetching}
            >
              Retry
            </Button>
          </div>
        )}
        {galleryUnavailable ? null : persons.length === 0 ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid="face-gallery-empty"
          >
            No one enrolled yet. Recognition still finds faces, but every face
            comes back as “Unknown” until someone is enrolled.
          </p>
        ) : (
          <ul className="space-y-2">
            {persons.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 rounded-lg border p-2"
              >
                <div className="flex shrink-0 -space-x-2">
                  {person.thumbnails.slice(0, 3).map((thumb, i) => {
                    // Thumbnails are data URLs from the worker.
                    let src = ''
                    for (const ch of safeMediaSrc(thumb)) {
                      let ok = ''
                      for (const allowed of MEDIA_SRC_CHARS)
                        if (allowed === ch) {
                          ok = allowed
                          break
                        }
                      if (!ok) {
                        src = ''
                        break
                      }
                      src += ok
                    }
                    return (
                      <RefImage
                        key={i}
                        src={src}
                        alt={`${person.name} reference ${i + 1}`}
                        className="border-background h-9 w-9 rounded-full border-2 object-cover"
                      />
                    )
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <TruncatedText
                    text={person.name}
                    className="text-sm font-medium"
                  />
                  <p className="text-muted-foreground text-xs">
                    {plural(person.num_images, 'image')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${person.name}`}
                  onClick={() => setRemoval({ kind: 'person', person })}
                >
                  <Trash2
                    aria-hidden="true"
                    className="text-destructive h-4 w-4"
                  />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open) setRemoval(null)
        }}
        variant="destructive"
        title={
          removal?.kind === 'all'
            ? 'Remove everyone from the gallery?'
            : `Remove ${removal?.kind === 'person' ? removal.person.name : ''}?`
        }
        description={
          removal?.kind === 'all'
            ? `${plural(persons.length, 'person')} and their reference photos are removed from the gallery. Faces will show as “Unknown” until people are enrolled again.`
            : 'Their reference photos are removed from the gallery; their face will show as “Unknown”.'
        }
        confirmLabel={removal?.kind === 'all' ? 'Clear all' : 'Remove'}
        pendingLabel="Removing…"
        onConfirm={confirmRemoval}
      />
    </Card>
  )
}
