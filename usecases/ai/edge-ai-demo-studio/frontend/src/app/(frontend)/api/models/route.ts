import { NextRequest, NextResponse } from 'next/server'
import { startMultiserveServer } from '@/lib/multiserve-handler'
import { Workload } from '@/payload-types'
import { logger } from '@/utils/logger'
import {
  KNOWN_QUANTIZATIONS,
  MULTISERVE_ENGINES,
  DEFAULT_MULTISERVE_FIELDS,
} from '@/lib/engine/multiserve'
import { ModelList } from '@/types/workload'
import { MultiserveModel } from '@/types/multiserve'
import { EMBEDDING_PORT, TEXT_GENERATION_PORT } from '@/lib/constants'
import { listProcesses } from '@/lib/process-handler'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'
import { EMBEDDING_TYPE } from '@/lib/workloads/embedding'

const getWorkloadPort = (type: Workload['type']) => {
  switch (type) {
    case TEXT_GENERATION_TYPE:
      return TEXT_GENERATION_PORT
    case EMBEDDING_TYPE:
      return EMBEDDING_PORT
    default:
      throw new Error(`Unsupported workload type: ${type}`)
  }
}

const getMultiserveType = (type: Workload['type'] | 'rerank') => {
  switch (type) {
    case 'rerank':
      return EMBEDDING_TYPE
    default:
      return type
  }
}

const pendingStartups = new Map<string, Promise<{ port: number }>>()

// Start a dummy multiserve instance (actual service but with no model) if not already running
const startDummyMultiserve = async (
  engine: Workload['engine'],
  type: Workload['type'],
) => {
  const workloadType = getMultiserveType(type)
  const lockKey = `${workloadType}`

  if (pendingStartups.has(lockKey)) {
    return pendingStartups.get(lockKey)!
  }

  const startupPromise = (async () => {
    try {
      const port = getWorkloadPort(workloadType)
      const processes = await listProcesses()
      const existingProcess = processes.find((proc) =>
        proc.name.startsWith(`${workloadType}_`),
      )

      if (existingProcess) {
        logger.info(`Multiserve for type ${workloadType} already running`)
        return { port }
      }

      const dummyWorkload: Workload = {
        id: 0,
        name: workloadType,
        type: workloadType,
        engine: engine as Workload['engine'],
        models: {
          default: { name: 'dummy', device: 'CPU' },
        },
        port: port,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }

      await startMultiserveServer(dummyWorkload)

      return { port }
    } finally {
      pendingStartups.delete(lockKey)
    }
  })()

  pendingStartups.set(lockKey, startupPromise)
  return startupPromise
}

const validateMultiserveRequest = (engine: string) => {
  const isMultiserve = MULTISERVE_ENGINES.map((e) => e.id).includes(engine)
  if (!isMultiserve) {
    return NextResponse.json(
      {
        error:
          'Unsupported engine. Only multiserve engines are supported for this operation.',
      },
      { status: 400 },
    )
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    let engine = searchParams.get('engine') as Workload['engine']
    const workloadType = searchParams.get('type') as Workload['type']

    if (!workloadType) {
      return NextResponse.json(
        { error: 'Missing workload type' },
        { status: 400 },
      )
    }

    if (!engine) {
      const processes = await listProcesses()
      const workloadTypeKey = getMultiserveType(workloadType)
      const existingProcess = processes.find((proc) =>
        proc.name.startsWith(`${workloadTypeKey}_`),
      )

      if (existingProcess) {
        for (const e of MULTISERVE_ENGINES) {
          if (existingProcess.name.includes(`_${e.id}_`)) {
            engine = e.id as Workload['engine']
            break
          }
        }
      }

      if (!engine) {
        engine = DEFAULT_MULTISERVE_FIELDS.engine
      }
    }

    const errorResponse = validateMultiserveRequest(engine)
    if (errorResponse) return errorResponse

    try {
      const { port } = await startDummyMultiserve(
        engine as Workload['engine'],
        workloadType,
      )

      const modelsURL = `http://localhost:${port}/v1/api/models?backend=${engine}`
      const res = await fetch(modelsURL, {})

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Failed to get multiserve models: ${err}`)
      }

      const data = (await res.json()) as Record<string, MultiserveModel[]>
      if (!data[engine]) {
        return NextResponse.json(
          { error: 'No Available models for provided engine' },
          { status: 404 },
        )
      }
      const models: ModelList =
        engine === 'llamacpp'
          ? data[engine]
              .filter(
                (model) => model.task_type === workloadType.replace('-', '_'),
              )
              .flatMap((model) => {
                const quants = Array.from(
                  new Set([
                    ...(model.verified || []),
                    ...(model.downloaded || []),
                  ]),
                )
                return quants.map((quant) => ({
                  id: model.repo_id.includes(':')
                    ? model.repo_id.split(':')[0]
                    : `${model.repo_id}:${quant}`,
                  engine: engine,
                  task: workloadType,
                  quant: quant,
                  verified: model.verified?.includes(quant),
                  downloaded: quant
                    ? model.downloaded?.includes(quant)
                    : model.downloaded.length > 0,
                }))
              })
          : data[engine]
              .filter(
                (model) => model.task_type === workloadType.replace('-', '_'),
              )
              .map((model) => {
                const quant = KNOWN_QUANTIZATIONS.find((q) =>
                  model.repo_id.includes(q),
                )
                return {
                  id: model.repo_id,
                  engine: engine,
                  task: workloadType,
                  quant: undefined,
                  verified: quant ? model.verified?.includes(quant) : false,
                  downloaded: quant
                    ? model.downloaded?.includes(quant)
                    : model.downloaded.length > 0,
                }
              })
      return NextResponse.json(models)
    } catch (err) {
      logger.error('Multiserve operation failed', err)
      return NextResponse.json(
        { error: 'Failed to reach multiserve backend' },
        { status: 500 },
      )
    }
  } catch (error) {
    logger.error('Upload handler error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const engine = formData.get('engine') as string
    const workloadType = formData.get('workload_type') as Workload['type']
    const requestType = formData.get('request_type') as string

    // Handle connection info request
    if (requestType === 'connection') {
      if (!engine) {
        return NextResponse.json({ error: 'Missing engine' }, { status: 400 })
      }

      const errorResponse = validateMultiserveRequest(engine)
      if (errorResponse) return errorResponse

      try {
        const { port } = await startDummyMultiserve(
          engine as Workload['engine'],
          workloadType,
        )
        return NextResponse.json({ port })
      } catch (err) {
        logger.error('Failed to get backend connection', err)
        return NextResponse.json(
          { error: 'Failed to establish backend connection' },
          { status: 500 },
        )
      }
    }

    const file = formData.get('file') as File

    if (!file || !engine) {
      return NextResponse.json(
        { error: 'Missing file or engine' },
        { status: 400 },
      )
    }

    const errorResponse = validateMultiserveRequest(engine)
    if (errorResponse) return errorResponse

    try {
      const { port } = await startDummyMultiserve(
        engine as Workload['engine'],
        workloadType,
      )

      // Upload to multiserve
      const chunkIndex = formData.get('chunk_index')
      const endpoint = chunkIndex
        ? `/v1/api/model/upload/chunk?backend=${engine}`
        : `/v1/api/model/upload?backend=${engine}`
      const uploadUrl = new URL(`http://localhost:${port}${endpoint}`)

      const uploadFormData = new FormData()
      for (const [key, value] of formData.entries()) {
        if (!['engine', 'workload_type', 'request_type'].includes(key)) {
          uploadFormData.append(key, value)
        }
      }

      const res = await fetch(uploadUrl, {
        method: 'POST',
        body: uploadFormData,
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Multiserve upload failed: ${err}`)
      }

      const data = await res.json()
      // Map internal_path from chunk upload or simple path from regular upload
      return NextResponse.json({
        tempPath: data.internal_path || data.path || data.id,
      })
    } catch (err) {
      logger.error('Multiserve operation failed', err)
      return NextResponse.json(
        { error: 'Failed to upload to multiserve backend' },
        { status: 500 },
      )
    }
  } catch (error) {
    logger.error('Upload handler error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { engine, workloadType, name } = await req.json()

    if (!engine || !workloadType || !name) {
      return NextResponse.json(
        { error: 'Missing engine, workload type, or name' },
        { status: 400 },
      )
    }

    const errorResponse = validateMultiserveRequest(engine)
    if (errorResponse) return errorResponse

    try {
      const { port } = await startDummyMultiserve(
        engine as Workload['engine'],
        workloadType,
      )

      const deleteUrl = `http://localhost:${port}/v1/api/model/delete?backend=${engine}`

      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repo_id: name,
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Multiserve delete failed: ${err}`)
      }

      const data = await res.json()
      return NextResponse.json({ tempPath: data.path || data.id })
    } catch (err) {
      logger.error('Multiserve operation failed', err)
      return NextResponse.json(
        { error: 'Failed to delete from multiserve backend' },
        { status: 500 },
      )
    }
  } catch (error) {
    logger.error('Delete handler error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
