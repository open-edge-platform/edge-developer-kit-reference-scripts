'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2 } from 'lucide-react'

interface ConfirmationDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  cancelText?: string
  confirmText?: string
  variant?: 'default' | 'destructive'
  isLoading?: boolean
  preventDismiss?: boolean
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  cancelText = 'Cancel',
  confirmText = 'Continue',
  variant = 'default',
  isLoading = false,
  preventDismiss = false,
}: ConfirmationDialogProps) {
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={preventDismiss ? undefined : onClose}
    >
      <AlertDialogContent
        onEscapeKeyDown={preventDismiss ? (e) => e.preventDefault() : undefined}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={isLoading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={isLoading}
            className={
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 text-white'
                : ''
            }
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
