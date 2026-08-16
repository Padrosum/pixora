import type { ImageSettings } from './image-processing'

type WorkerResponse = { type: 'success'; blob: Blob } | { type: 'error'; message: string }

export function renderImageInWorker(file: File, settings: ImageSettings, signal?: AbortSignal): Promise<Blob> {
  const worker = new Worker(new URL('../workers/image-worker.ts', import.meta.url), { type: 'module' })

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      worker.terminate()
      signal?.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      if (settled) return
      settled = true
      finish()
      reject(new DOMException('Batch processing was cancelled.', 'AbortError'))
    }

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (settled) return
      settled = true
      finish()
      if (data.type === 'success') resolve(data.blob)
      else reject(new Error(data.message))
    }
    worker.onerror = () => {
      if (settled) return
      settled = true
      finish()
      reject(new Error('This image could not be processed in a Web Worker.'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    else worker.postMessage({ file, sourceType: file.type, settings })
  })
}
