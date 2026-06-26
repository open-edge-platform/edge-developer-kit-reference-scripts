// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { UIMessage } from 'ai'
import { useRoboticsChat } from './use-agent'
import { useCameraReloadMutation } from './use-camera-reload'
import { useCameraStatusQuery } from './use-camera-status'
import { useMcpConnectMutation } from './use-mcp-connect'
import {
  useCalibrationStatusQuery,
  usePrerequisitesQuery,
} from './use-prerequisites'
import {
  useRobotPortsQuery,
  useRobotTypeQuery,
  useRobotTypesQuery,
  useSetRobotTypeMutation,
} from './use-robot-type'
import {
  useCalibrationConfirmMutation,
  useCalibrationStartMutation,
} from './use-calibration'
import {
  type JointReading,
  type MotorCalibrationState,
  useMotorCalibrationNextMutation,
  useMotorCalibrationStartMutation,
  useMotorCalibrationStatusQuery,
} from './use-motor-calibration'
import {
  useGripperConfigQuery,
  useSetGripperConfigMutation,
} from './use-gripper-config'
import {
  type ArucoDetectResult,
  useArucoCalibrateMutation,
  useArucoDetectQuery,
} from './use-aruco-calibration'
import { useTranscribe } from '@/services/speech-to-text/hooks'

export type { ArucoDetectResult } from './use-aruco-calibration'
export type { JointReading } from './use-motor-calibration'
export type { UIMessage as ChatMessage } from 'ai'

export interface ToolOption {
  id: string
  name: string
  description?: string
  server?: string
}

// ── Constants ─────────────────────────────────────────────────────

export const DEFAULT_CHAT_SUGGESTIONS = [
  'What can you see right now?',
  'Pickup all the items in the workspace',
  'Pickup the cube',
]

const KNOWN_ROBOT_TYPES = ['SO-ARM101']

// ── Helpers ───────────────────────────────────────────────────────

const normalizeTools = (rawTools: unknown): ToolOption[] => {
  const tools: ToolOption[] = []

  const pushTool = (
    tool: Record<string, unknown>,
    serverLabel?: string,
    fallbackIndex?: number,
  ) => {
    const rawId = typeof tool.id === 'string' ? tool.id : undefined
    const name = tool.name
    if (typeof name !== 'string' || !name.trim()) return

    const description =
      typeof tool.description === 'string' ? tool.description : undefined
    const server = serverLabel ?? undefined
    const idSource = server ? `${server}::${name}` : name
    const id =
      rawId && rawId.trim().length > 0
        ? rawId
        : fallbackIndex !== undefined
          ? `${idSource}::${fallbackIndex}`
          : idSource
    tools.push({ id, name, description, server })
  }

  if (Array.isArray(rawTools)) {
    rawTools.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return
      const entryRecord = entry as Record<string, unknown>
      const serverLabel =
        typeof entryRecord.server === 'string' ? entryRecord.server : undefined
      const nestedTools = entryRecord.tools
      if (Array.isArray(nestedTools)) {
        nestedTools.forEach((tool, toolIndex) => {
          if (!tool || typeof tool !== 'object') return
          pushTool(tool as Record<string, unknown>, serverLabel, toolIndex)
        })
        return
      }
      pushTool(entryRecord, serverLabel, index)
    })
    return tools
  }

  if (rawTools && typeof rawTools === 'object') {
    Object.entries(rawTools as Record<string, unknown>).forEach(
      ([serverLabel, value]) => {
        if (Array.isArray(value)) {
          value.forEach((tool, toolIndex) => {
            if (!tool || typeof tool !== 'object') return
            pushTool(tool as Record<string, unknown>, serverLabel, toolIndex)
          })
        } else if (value && typeof value === 'object') {
          pushTool(value as Record<string, unknown>, serverLabel)
        }
      },
    )
  }

  return tools
}

const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url, 'http://localhost')
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const getMicErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')
      return 'No microphone found. Please connect a microphone and try again.'
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    )
      return 'Microphone access denied. Please allow microphone permissions.'
  }
  if (error instanceof Error) return error.message
  return 'Failed to access microphone.'
}

// ── Hook ──────────────────────────────────────────────────────────

export interface UseRoboticsAiDemoReturn {
  workerBaseUrl: string
  setWorkerBaseUrl: (v: string) => void
  isConnected: boolean
  setIsConnected: (v: boolean) => void
  mcpStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  mcpStatusMessage: string
  mcpStatusClass: string
  mcpStatusLabel: string
  messages: UIMessage[]
  input: string
  setInput: (v: string) => void
  isLoading: boolean
  availableTools: ToolOption[]
  selectedToolId: string
  setSelectedToolId: (id: string) => void
  selectedTool: ToolOption | undefined
  isListening: boolean
  isTranscribing: boolean
  micError: string | null
  micLanguage: string
  setMicLanguage: (lang: string) => void
  micLanguageOptions: { label: string; value: string }[]
  selectedMicLanguageLabel: string
  isReloadingCamera: boolean
  cameraStatusMessage: string
  hasMicrophone: boolean
  micButtonDisabled: boolean
  imgRef: RefObject<HTMLImageElement | null>
  chatMessagesRef: RefObject<HTMLDivElement | null>
  handleMicLanguageChange: (lang: string) => void
  handleReset: () => void
  sendMessage: (content: string) => Promise<void>
  handleSuggestionClick: (suggestion: string) => void
  handleReloadCamera: () => Promise<void>
  connectMcpServer: () => Promise<void>
  handleMicStartListening: () => void
  handleMicStopListening: () => void
  robotTypeReady: boolean
  isRobotTypeLoading: boolean
  isPrerequisitesLoading: boolean
  prerequisites: { dialout: boolean; librealsense: boolean } | undefined
  calibrationStatus:
    | { motor_calibrated: boolean; camera_calibrated: boolean }
    | undefined
  refetchCalibrationStatus: () => void
  availableRobotTypes: string[]
  availableRobotPorts: {
    device: string
    description: string
    manufacturer: string
  }[]
  selectedSetupRobotType: string
  setSelectedSetupRobotType: (type: string) => void
  selectedSetupRobotPort: string
  setSelectedSetupRobotPort: (port: string) => void
  isSettingRobotType: boolean
  robotTypeSetError: string | null
  handleConfirmRobotType: () => Promise<boolean>
  calibrationState: 'idle' | 'awaiting_confirmation'
  isCalibrationStarting: boolean
  isCalibrationConfirming: boolean
  calibrationError: string | null
  calibrationMessage: string | null
  handleCalibrationStart: () => Promise<void>
  handleCalibrationConfirm: () => Promise<void>
  motorCalibrationState: MotorCalibrationState
  motorCalibrationJointReadings: JointReading[]
  isMotorCalibrationStarting: boolean
  isMotorCalibrationNexting: boolean
  motorCalibrationError: string | null
  motorCalibrationMessage: string | null
  handleMotorCalibrationStart: () => Promise<void>
  handleMotorCalibrationNext: (choice?: 'use_existing' | 'run') => Promise<void>
  gripperOpen: number
  gripperClose: number
  setGripperOpen: (v: number) => void
  setGripperClose: (v: number) => void
  isSavingGripperConfig: boolean
  gripperConfigError: string | null
  gripperConfigMessage: string | null
  handleSaveGripperConfig: () => Promise<void>
  arucoDetectResult: ArucoDetectResult | null
  isArucoPolling: boolean
  setIsArucoPolling: (v: boolean) => void
  isArucoCalibrating: boolean
  arucoError: string | null
  arucoMessage: string | null
  handleArucoCalibrate: () => Promise<void>
  useMcp: boolean
  setUseMcp: (v: boolean) => void
}

export function useRoboticsAiDemo(): UseRoboticsAiDemoReturn {
  const [workerBaseUrl, setWorkerBaseUrl] = useState(
    process.env.NEXT_PUBLIC_ROBOTICS_WORKER_URL ?? '/api/robotics-ai',
  )
  const [isConnected, setIsConnected] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('connecting')
  const [mcpStatusMessage, setMcpStatusMessage] = useState(
    'Connecting to MCP server\u2026',
  )
  const [input, setInput] = useState('')
  const [availableTools, setAvailableTools] = useState<ToolOption[]>([])
  const [selectedToolId, setSelectedToolId] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [micLanguage, setMicLanguage] = useState('en')
  const [cameraStatusMessage, setCameraStatusMessage] = useState(
    'Waiting for camera…',
  )
  const [hasMicrophone, setHasMicrophone] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [selectedSetupRobotTypeState, setSelectedSetupRobotType] = useState('')
  const [selectedSetupRobotPort, setSelectedSetupRobotPort] = useState('')
  const [robotTypeSetError, setRobotTypeSetError] = useState<string | null>(
    null,
  )
  const [calibrationState, setCalibrationState] = useState<
    'idle' | 'awaiting_confirmation'
  >('idle')
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(
    null,
  )
  const [motorCalibrationLocalState, setMotorCalibrationState] =
    useState<MotorCalibrationState>('idle')
  const [motorCalibrationError, setMotorCalibrationError] = useState<
    string | null
  >(null)
  const [motorCalibrationMessage, setMotorCalibrationMessage] = useState<
    string | null
  >(null)
  const motorCalibrationPolling =
    motorCalibrationLocalState === 'awaiting_calibration_choice' ||
    motorCalibrationLocalState === 'awaiting_middle_position' ||
    motorCalibrationLocalState === 'awaiting_range_motion'
  const [gripperOpenOverride, setGripperOpen] = useState<number | undefined>(
    undefined,
  )
  const [gripperCloseOverride, setGripperClose] = useState<number | undefined>(
    undefined,
  )
  const [gripperConfigError, setGripperConfigError] = useState<string | null>(
    null,
  )
  const [gripperConfigMessage, setGripperConfigMessage] = useState<
    string | null
  >(null)
  const [isArucoPolling, setIsArucoPolling] = useState(false)
  const [arucoError, setArucoError] = useState<string | null>(null)
  const [arucoMessage, setArucoMessage] = useState<string | null>(null)
  const [useMcp, setUseMcp] = useState(true)

  const { data: prerequisitesData, isLoading: isPrerequisitesLoading } =
    usePrerequisitesQuery(workerBaseUrl)

  const {
    data: robotTypeData,
    isLoading: isRobotTypeLoading,
    refetch: refetchRobotType,
  } = useRobotTypeQuery(workerBaseUrl)
  const { data: robotTypesData } = useRobotTypesQuery(workerBaseUrl)
  const { data: robotPortsData } = useRobotPortsQuery(workerBaseUrl)
  const {
    mutateAsync: setRobotTypeMutateAsync,
    isPending: isSettingRobotType,
  } = useSetRobotTypeMutation()

  const {
    mutateAsync: calibrationStartMutateAsync,
    isPending: isCalibrationStarting,
  } = useCalibrationStartMutation()
  const {
    mutateAsync: calibrationConfirmMutateAsync,
    isPending: isCalibrationConfirming,
  } = useCalibrationConfirmMutation()

  const { data: motorCalibrationStatusData } = useMotorCalibrationStatusQuery(
    workerBaseUrl,
    motorCalibrationPolling,
  )
  const {
    mutateAsync: motorCalibrationStartMutateAsync,
    isPending: isMotorCalibrationStarting,
  } = useMotorCalibrationStartMutation()
  const {
    mutateAsync: motorCalibrationNextMutateAsync,
    isPending: isMotorCalibrationNexting,
  } = useMotorCalibrationNextMutation()
  const { data: gripperConfigData } = useGripperConfigQuery(workerBaseUrl)
  const {
    mutateAsync: setGripperConfigMutateAsync,
    isPending: isSavingGripperConfig,
  } = useSetGripperConfigMutation()
  const { data: arucoDetectData } = useArucoDetectQuery(
    workerBaseUrl,
    isArucoPolling,
  )
  const {
    mutateAsync: arucoCalibrateMutateAsync,
    isPending: isArucoCalibrating,
  } = useArucoCalibrateMutation()

  const { data: calibrationStatusData, refetch: refetchCalibrationStatus } =
    useCalibrationStatusQuery(
      workerBaseUrl,
      !isRobotTypeLoading &&
        !!robotTypeData &&
        !!(robotTypeData.type && robotTypeData.type.toLowerCase() !== 'none'),
    )

  const {
    messages,
    sendMessage: chatSendMessage,
    status: chatStatus,
    setMessages: setChatMessages,
  } = useRoboticsChat()
  const {
    mutateAsync: cameraReloadMutateAsync,
    isPending: isCameraReloadPending,
  } = useCameraReloadMutation()
  const { mutateAsync: mcpConnectMutateAsync } = useMcpConnectMutation()
  const { mutateAsync: transcribeMutateAsync, isPending: isTranscribing } =
    useTranscribe()

  // Derived: camera polling is active whenever the stream is not connected
  const cameraPolling = !isConnected

  const { data: cameraStatusData } = useCameraStatusQuery(
    workerBaseUrl,
    cameraPolling,
    1000,
  )

  const availableRobotTypes = useMemo(
    () => robotTypesData?.types ?? KNOWN_ROBOT_TYPES,
    [robotTypesData],
  )
  const availableRobotPorts = useMemo(
    () => robotPortsData?.ports ?? [],
    [robotPortsData],
  )
  // robotTypeReady is true only when the query returned a non-null/non-"none" type
  const robotTypeReady =
    !isRobotTypeLoading &&
    !!robotTypeData &&
    !!(robotTypeData.type && robotTypeData.type.toLowerCase() !== 'none')

  // Derived state: default to first available robot type if none explicitly chosen
  const selectedSetupRobotType =
    selectedSetupRobotTypeState || availableRobotTypes[0] || ''

  // Derived state: prefer server data, fall back to local override
  const motorCalibrationState: MotorCalibrationState =
    motorCalibrationStatusData?.state ?? motorCalibrationLocalState

  // Derived state: user override takes priority; falls back to server config then hardcoded default
  const gripperOpen =
    gripperOpenOverride ?? gripperConfigData?.gripper_open ?? 60
  const gripperClose =
    gripperCloseOverride ?? gripperConfigData?.gripper_close ?? 40

  const isLoading = chatStatus === 'submitted' || chatStatus === 'streaming'
  const isReloadingCamera = isCameraReloadPending
  const micButtonDisabled =
    (!hasMicrophone && !isListening) ||
    (isLoading && !isListening) ||
    (isTranscribing && !isListening)

  const imgRef = useRef<HTMLImageElement>(null)
  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const isMcpConnectingRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const isUploadingRef = useRef(false)
  const hasUserSetMicLanguage = useRef(false)

  const selectedTool = useMemo(
    () => availableTools.find((tool) => tool.id === selectedToolId),
    [availableTools, selectedToolId],
  )

  const micLanguageOptions = useMemo(
    () => [
      { label: 'English', value: 'en' },
      { label: 'Malay', value: 'ms' },
      { label: 'Chinese', value: 'zh' },
      { label: 'Japanese', value: 'ja' },
    ],
    [],
  )

  const mapLanguageToAgentName = useCallback((code: string) => {
    const map: Record<string, string> = {
      en: 'english',
      ms: 'malay',
      zh: 'chinese',
      ja: 'japanese',
    }
    return map[code] ?? 'english'
  }, [])

  const selectedMicLanguageLabel = useMemo(() => {
    return (
      micLanguageOptions.find((o) => o.value === micLanguage)?.label ??
      'English'
    )
  }, [micLanguage, micLanguageOptions])

  const handleConfirmRobotType = useCallback(async (): Promise<boolean> => {
    if (!selectedSetupRobotType || isSettingRobotType) return false
    setRobotTypeSetError(null)
    try {
      await setRobotTypeMutateAsync({
        workerBaseUrl,
        type: selectedSetupRobotType,
        port: selectedSetupRobotPort || undefined,
      })
      await refetchRobotType()
      return true
    } catch (error) {
      const msg =
        error instanceof TypeError &&
        error.message.toLowerCase().includes('fetch')
          ? 'Could not reach the worker. Please check the Worker URL and ensure the service is running.'
          : error instanceof Error
            ? error.message
            : 'Failed to set robot type.'
      setRobotTypeSetError(msg)
      return false
    }
  }, [
    selectedSetupRobotType,
    selectedSetupRobotPort,
    isSettingRobotType,
    workerBaseUrl,
    setRobotTypeMutateAsync,
    refetchRobotType,
  ])

  const handleSaveGripperConfig = useCallback(async () => {
    setGripperConfigError(null)
    setGripperConfigMessage(null)
    try {
      const result = await setGripperConfigMutateAsync({
        workerBaseUrl,
        gripperOpen,
        gripperClose,
      })
      setGripperConfigMessage(result.message)
    } catch (error) {
      setGripperConfigError(
        error instanceof Error
          ? error.message
          : 'Failed to save gripper configuration.',
      )
    }
  }, [workerBaseUrl, gripperOpen, gripperClose, setGripperConfigMutateAsync])

  const handleArucoCalibrate = useCallback(async () => {
    setArucoError(null)
    setArucoMessage(null)
    try {
      const result = await arucoCalibrateMutateAsync({ workerBaseUrl })
      setArucoMessage(result.message)
    } catch (error) {
      setArucoError(
        error instanceof Error ? error.message : 'Camera calibration failed.',
      )
    }
  }, [workerBaseUrl, arucoCalibrateMutateAsync])

  const handleMotorCalibrationStart = useCallback(async () => {
    setMotorCalibrationError(null)
    setMotorCalibrationMessage(null)
    try {
      const result = await motorCalibrationStartMutateAsync({ workerBaseUrl })
      setMotorCalibrationState(result.state)
      setMotorCalibrationMessage(result.message)
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Failed to start motor calibration.'
      // Handle 409 — calibration already in progress. Extract the state and sync.
      const stateMatch = msg.match(/state:\s*'(\w+)'/)
      if (stateMatch) {
        const recoveredState = stateMatch[1] as MotorCalibrationState
        setMotorCalibrationState(recoveredState)
        setMotorCalibrationMessage(
          'Calibration already in progress. Resuming from current step.',
        )
      } else {
        setMotorCalibrationError(msg)
      }
    }
  }, [workerBaseUrl, motorCalibrationStartMutateAsync])

  const handleMotorCalibrationNext = useCallback(
    async (choice?: 'use_existing' | 'run') => {
      setMotorCalibrationError(null)
      setMotorCalibrationMessage(null)
      try {
        const result = await motorCalibrationNextMutateAsync({
          workerBaseUrl,
          choice,
        })
        setMotorCalibrationState(result.state)
        setMotorCalibrationMessage(result.message)
      } catch (error) {
        setMotorCalibrationError(
          error instanceof Error
            ? error.message
            : 'Failed to advance motor calibration.',
        )
      }
    },
    [workerBaseUrl, motorCalibrationNextMutateAsync],
  )

  const handleCalibrationStart = useCallback(async () => {
    setCalibrationError(null)
    setCalibrationMessage(null)
    try {
      const result = await calibrationStartMutateAsync({ workerBaseUrl })
      setCalibrationState('awaiting_confirmation')
      setCalibrationMessage(result.message)
    } catch (error) {
      setCalibrationError(
        error instanceof Error ? error.message : 'Failed to start calibration.',
      )
    }
  }, [workerBaseUrl, calibrationStartMutateAsync])

  const handleCalibrationConfirm = useCallback(async () => {
    setCalibrationError(null)
    setCalibrationMessage(null)
    try {
      const result = await calibrationConfirmMutateAsync({ workerBaseUrl })
      setCalibrationState('idle')
      setCalibrationMessage(result.message)
    } catch (error) {
      setCalibrationState('idle')
      setCalibrationError(
        error instanceof Error
          ? error.message
          : 'Failed to confirm calibration.',
      )
    }
  }, [workerBaseUrl, calibrationConfirmMutateAsync])

  const handleReset = useCallback(() => {
    setChatMessages([])
    setInput('')
  }, [setChatMessages])

  const sendMessage = useCallback(
    async (messageContent: string) => {
      const trimmed = messageContent.trim()
      if (!trimmed || isLoading) return
      setInput('')
      const toolIdForRequest = selectedToolId.trim()
        ? selectedToolId
        : undefined
      chatSendMessage(
        { text: trimmed },
        {
          body: {
            workerBaseUrl,
            toolId: toolIdForRequest,
            language: mapLanguageToAgentName(micLanguage),
            useMcp,
          },
        },
      )
    },
    [
      isLoading,
      selectedToolId,
      micLanguage,
      workerBaseUrl,
      chatSendMessage,
      mapLanguageToAgentName,
      useMcp,
    ],
  )

  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      if (!isLoading) await sendMessage(suggestion)
    },
    [isLoading, sendMessage],
  )

  const connect = useCallback(() => {
    const mjpegImg = imgRef.current
    if (!mjpegImg) return
    if (!isSafeUrl(workerBaseUrl)) return
    mjpegImg.src = `${workerBaseUrl}/stream/camera?ts=${Date.now()}`
  }, [workerBaseUrl])

  const startCameraPolling = useCallback(() => {
    setCameraStatusMessage('Waiting for camera…')
  }, [])

  const handleReloadCamera = useCallback(async () => {
    if (isCameraReloadPending) return
    setCameraStatusMessage('Reloading camera\u2026')
    setIsConnected(false)
    try {
      await cameraReloadMutateAsync({ workerBaseUrl })
      startCameraPolling()
    } catch (error) {
      setCameraStatusMessage(
        error instanceof Error
          ? `Failed to reload camera: ${error.message}`
          : 'Failed to reload camera.',
      )
    }
  }, [
    startCameraPolling,
    isCameraReloadPending,
    workerBaseUrl,
    cameraReloadMutateAsync,
  ])

  const connectMcpServer = useCallback(async () => {
    if (isMcpConnectingRef.current) return
    isMcpConnectingRef.current = true
    setMcpStatus('connecting')
    setMcpStatusMessage('Connecting to MCP server\u2026')
    try {
      const payload = await mcpConnectMutateAsync({ workerBaseUrl })
      const tools = normalizeTools(payload.tools)
      setAvailableTools(tools)
      setSelectedToolId((prev) =>
        prev && tools.some((t) => t.id === prev) ? prev : '',
      )
      setMcpStatus('connected')
      setMcpStatusMessage(payload.message ?? 'Connected to MCP server')
    } catch (error) {
      setMcpStatus('error')
      setMcpStatusMessage(
        error instanceof Error ? error.message : 'Failed to connect',
      )
      setAvailableTools([])
      setSelectedToolId('')
    } finally {
      isMcpConnectingRef.current = false
    }
  }, [workerBaseUrl, mcpConnectMutateAsync])

  const handleMicStartListening = useCallback(() => {
    if (isListening || typeof window === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia) return
    if (typeof MediaRecorder === 'undefined') return
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    )
      return

    setMicError(null)
    setIsListening(true)
    recordedChunksRef.current = []

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        let recorder: MediaRecorder
        try {
          recorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus',
          })
        } catch {
          recorder = new MediaRecorder(stream)
        }

        const uploadChunks = async () => {
          const blob = new Blob(recordedChunksRef.current, {
            type: 'audio/webm',
          })
          const data = await transcribeMutateAsync({
            file: blob,
            language: micLanguage,
            useDenoise: false,
          })
          const text = typeof data?.text === 'string' ? data.text : ''
          setInput(text)
          return text
        }

        mediaRecorderRef.current = recorder

        recorder.ondataavailable = async (event: BlobEvent) => {
          if (event.data && event.data.size > 0)
            recordedChunksRef.current.push(event.data)
          if (isUploadingRef.current) return
          isUploadingRef.current = true
          try {
            await uploadChunks()
          } catch (error) {
            setMicError(
              error instanceof Error
                ? `Transcription failed: ${error.message}`
                : 'Transcription failed.',
            )
            // Stop recording if the STT server is unreachable
            const rec = mediaRecorderRef.current
            if (rec && rec.state !== 'inactive') {
              try {
                rec.stop()
              } catch {
                // ignore
              }
            }
          } finally {
            isUploadingRef.current = false
          }
        }

        recorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop())
          try {
            while (isUploadingRef.current) {
              await new Promise<void>((resolve) =>
                setTimeout(() => {
                  resolve()
                }, 100),
              )
            }
            if (recordedChunksRef.current.length > 0) {
              await uploadChunks()
            }
          } catch (error) {
            setMicError(
              error instanceof Error
                ? `Transcription failed: ${error.message}`
                : 'Transcription failed.',
            )
          } finally {
            recordedChunksRef.current = []
            mediaRecorderRef.current = null
            isUploadingRef.current = false
            setIsListening(false)
          }
        }

        recorder.start(1000)
      })
      .catch((error: unknown) => {
        setIsListening(false)
        setMicError(getMicErrorMessage(error))
      })
  }, [isListening, micLanguage, transcribeMutateAsync])

  const handleMicLanguageChange = useCallback((lang: string) => {
    hasUserSetMicLanguage.current = true
    setMicLanguage(lang)
  }, [])

  const handleMicStopListening = useCallback(() => {
    setIsListening(false)
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    try {
      recorder.stop()
    } catch {
      // ignore
    }
  }, [])

  // When camera reports ready and stream is not yet connected, start the MJPEG stream
  useEffect(() => {
    if (isConnected || !cameraStatusData?.ready) return
    connect()
  }, [isConnected, cameraStatusData, connect])

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (isMcpConnectingRef.current) return
    let cancelled = false
    isMcpConnectingRef.current = true
    mcpConnectMutateAsync({ workerBaseUrl })
      .then((payload) => {
        if (cancelled) return
        isMcpConnectingRef.current = false
        const tools = normalizeTools(payload.tools)
        setAvailableTools(tools)
        setSelectedToolId((prev) =>
          prev && tools.some((t) => t.id === prev) ? prev : '',
        )
        setMcpStatus('connected')
        setMcpStatusMessage(payload.message ?? 'Connected to MCP server')
      })
      .catch((error) => {
        if (cancelled) return
        isMcpConnectingRef.current = false
        setMcpStatus('error')
        setMcpStatusMessage(
          error instanceof Error ? error.message : 'Failed to connect',
        )
        setAvailableTools([])
        setSelectedToolId('')
      })
    return () => {
      cancelled = true
      isMcpConnectingRef.current = false
    }
  }, [workerBaseUrl, mcpConnectMutateAsync])

  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.enumerateDevices
    )
      return
    const checkMic = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setHasMicrophone(devices.some((d) => d.kind === 'audioinput'))
      } catch {
        setHasMicrophone(false)
      }
    }
    checkMic().catch(() => {
      setHasMicrophone(false)
    })
    navigator.mediaDevices.addEventListener('devicechange', checkMic)
    return () =>
      navigator.mediaDevices.removeEventListener('devicechange', checkMic)
  }, [])

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.stream.getTracks().forEach((track) => track.stop())
        recorder.stop()
      }
    }
  }, [])

  const mcpStatusClass = {
    connected:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    connecting:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    error: 'bg-destructive/10 text-destructive',
    disconnected: 'bg-muted text-muted-foreground',
  }[mcpStatus]

  const mcpStatusLabel = {
    connected: 'MCP Connected',
    connecting: 'MCP Connecting',
    error: 'MCP Error',
    disconnected: 'MCP Disconnected',
  }[mcpStatus]

  return {
    workerBaseUrl,
    setWorkerBaseUrl,
    isConnected,
    setIsConnected,
    mcpStatus,
    mcpStatusMessage,
    mcpStatusClass,
    mcpStatusLabel,
    messages,
    input,
    setInput,
    isLoading,
    availableTools,
    selectedToolId,
    setSelectedToolId,
    selectedTool,
    isListening,
    isTranscribing,
    micError,
    micLanguage,
    setMicLanguage,
    micLanguageOptions,
    selectedMicLanguageLabel,
    isReloadingCamera,
    cameraStatusMessage: cameraPolling ? cameraStatusMessage : '',
    hasMicrophone,
    micButtonDisabled,
    imgRef,
    chatMessagesRef,
    handleMicLanguageChange,
    handleReset,
    sendMessage,
    handleSuggestionClick,
    handleReloadCamera,
    connectMcpServer,
    handleMicStartListening,
    handleMicStopListening,
    robotTypeReady,
    isRobotTypeLoading,
    isPrerequisitesLoading,
    prerequisites: prerequisitesData,
    calibrationStatus: calibrationStatusData,
    refetchCalibrationStatus,
    availableRobotTypes,
    availableRobotPorts,
    selectedSetupRobotType,
    setSelectedSetupRobotType,
    selectedSetupRobotPort,
    setSelectedSetupRobotPort,
    isSettingRobotType,
    robotTypeSetError,
    handleConfirmRobotType,
    calibrationState,
    isCalibrationStarting,
    isCalibrationConfirming,
    calibrationError,
    calibrationMessage,
    handleCalibrationStart,
    handleCalibrationConfirm,
    motorCalibrationState,
    motorCalibrationJointReadings:
      motorCalibrationStatusData?.joint_readings ?? [],
    isMotorCalibrationStarting,
    isMotorCalibrationNexting,
    motorCalibrationError:
      motorCalibrationError ??
      (motorCalibrationState === 'error' && !motorCalibrationMessage
        ? 'Motor calibration process exited unexpectedly. Please try again.'
        : null),
    motorCalibrationMessage,
    handleMotorCalibrationStart,
    handleMotorCalibrationNext,
    gripperOpen,
    gripperClose,
    setGripperOpen,
    setGripperClose,
    isSavingGripperConfig,
    gripperConfigError,
    gripperConfigMessage,
    handleSaveGripperConfig,
    arucoDetectResult: arucoDetectData ?? null,
    isArucoPolling,
    setIsArucoPolling,
    isArucoCalibrating,
    arucoError,
    arucoMessage,
    handleArucoCalibrate,
    useMcp,
    setUseMcp,
  }
}
