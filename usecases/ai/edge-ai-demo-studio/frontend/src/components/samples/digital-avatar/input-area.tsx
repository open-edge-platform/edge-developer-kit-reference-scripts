import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import useAudioRecorder from '@/hooks/use-audio-recorder'
import { useSpeechToText } from '@/hooks/use-stt'
import { Send, Mic, MicOff, Square, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

export const InputArea = ({
  disabled,
  clearChat,
  setClearChat,
  isSTTEnabled,
  isDenoiseEnabled,
  sendMessage,
  onStop,
  isStreaming,
  isReady,
}: {
  disabled: boolean
  clearChat?: boolean
  setClearChat?: (value: boolean) => void
  isSTTEnabled: boolean
  isDenoiseEnabled: boolean
  sendMessage: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  isReady: boolean
}) => {
  const {
    startRecording,
    stopRecording,
    clearRecording,
    recording: isListening,
    audioBlob,
    visualizerData,
    durationSeconds,
    isDeviceFound,
    hasSoundRef,
    wasAutomaticallyStoppedRef,
  } = useAudioRecorder()
  const processedAudioBlobRef = useRef<Blob | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const transcription = useSpeechToText()

  const [input, setInput] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const isLoading = useMemo(() => {
    return isStreaming || !isReady
  }, [isStreaming, isReady])

  const toggleVoiceRecognition = () => {
    if (!isListening) {
      startRecording()
    } else {
      stopRecording()
    }
  }

  useEffect(() => {
    if (clearChat) {
      stopRecording()
      clearRecording()
      processedAudioBlobRef.current = null
      setInput('')
      if (setClearChat) {
        setClearChat(false)
      }
    }
  }, [clearChat, stopRecording, clearRecording, setClearChat])

  useEffect(() => {
    if (!isLoading && wasAutomaticallyStoppedRef.current) {
      // automatically start recording again after the previous recording was auto-stopped
      startRecording()
      wasAutomaticallyStoppedRef.current = false
    }
  }, [isLoading, startRecording, wasAutomaticallyStoppedRef])

  // Handle audioBlob availability after recording stops - transcribe and send
  useEffect(() => {
    if (audioBlob && audioBlob !== processedAudioBlobRef.current) {
      if (!hasSoundRef.current) {
        console.log('No sound detected in the recording. Please try again.')
        clearRecording()
        return
      }

      processedAudioBlobRef.current = audioBlob

      const transcribeAndSend = async () => {
        try {
          setIsTranscribing(true)
          const audioFile = new File([audioBlob], 'recording.webm', {
            type: 'audio/webm',
          })

          const response = await transcription.mutateAsync({
            file: audioFile,
            language: 'en',
            useDenoise: isDenoiseEnabled,
          })

          if (response.text) {
            setInput(response.text)
            // Auto-send the transcribed text
            sendMessage(response.text)
            setInput('')
          }

          // Clear the recording after transcription
          clearRecording()
          processedAudioBlobRef.current = null
          setIsTranscribing(false)
        } catch (error) {
          console.error('Transcription error:', error)
          toast.error('Failed to transcribe audio. Please try again.')
          clearRecording()
          processedAudioBlobRef.current = null
          setIsTranscribing(false)
        }
      }

      transcribeAndSend()
    }
  }, [
    audioBlob,
    clearRecording,
    hasSoundRef,
    isDenoiseEnabled,
    sendMessage,
    transcription,
  ])

  const handleStop = () => {
    onStop()
    if (isListening || wasAutomaticallyStoppedRef.current) {
      stopRecording()
      clearRecording()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && input.trim() && !isLoading) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleSendMessage = () => {
    sendMessage(input)
    setInput('')
  }

  const formatSeconds = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex gap-2">
      {isTranscribing ? (
        // Transcribing mode - show loading indicator
        <div className="flex h-[80px] flex-1 items-center justify-center rounded-md border bg-slate-50 dark:bg-slate-900">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-500" />
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Transcribing audio...
          </span>
        </div>
      ) : isListening ? (
        // Recording mode - show visualizer
        <>
          <div className="flex h-[80px] flex-1 items-center justify-between overflow-hidden rounded-md border-2 border-red-500 bg-slate-50 px-3 dark:bg-slate-900">
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              {formatSeconds(durationSeconds)}
            </span>
            <div className="mx-4 flex h-8 flex-1 items-center gap-0.5 overflow-hidden">
              {visualizerData.slice(-100).map((rms, index) => (
                <div
                  key={index}
                  className="w-1 rounded-sm bg-red-500"
                  style={{
                    height: `${Math.min(100, Math.max(8, rms * 100))}%`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Recording...
            </span>
          </div>
          {isSTTEnabled && (
            <Button
              variant="destructive"
              size="icon"
              onClick={toggleVoiceRecognition}
              className="h-[80px] w-12"
              title="Stop listening"
            >
              <MicOff className="h-4 w-4" />
            </Button>
          )}
        </>
      ) : (
        // Normal mode - show input
        <>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask me anything or start a conversation..."
            className="h-[80px] max-h-[80px] resize-none overflow-y-auto"
            disabled={disabled}
          />
          {isLoading ? (
            <Button
              onClick={handleStop}
              variant="destructive"
              size="icon"
              className="h-[80px] w-12"
              disabled={disabled}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <div className="flex flex-row gap-2">
              <Button
                disabled={disabled || !input.trim()}
                onClick={handleSendMessage}
                className="h-[80px] w-12"
              >
                <Send className="h-4 w-4" />
              </Button>
              {isSTTEnabled && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleVoiceRecognition}
                  disabled={!isDeviceFound || disabled || isLoading}
                  className="h-[80px] w-12"
                  title={
                    !isDeviceFound
                      ? 'Microphone not found'
                      : 'Start voice recognition'
                  }
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
