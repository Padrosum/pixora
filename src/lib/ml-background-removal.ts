type MlDevice = 'gpu' | 'cpu'
type ProgressHandler = (progress: number, stage: string) => void
type RemoveBackgroundEngine = (source: Blob, config: {
  device: MlDevice
  proxyToWorker: boolean
  model: 'isnet_quint8' | 'isnet_fp16' | 'isnet'
  output: { format: 'image/png'; quality: number }
  progress: (key: string, current: number, total: number) => void
}) => Promise<Blob>

export const ML_MODEL_SIZE_LABEL = '~75 MB on first run (model + runtime)'

let enginePromise: Promise<RemoveBackgroundEngine> | null = null

function loadEngine(): Promise<RemoveBackgroundEngine> {
  enginePromise ??= import('@imgly/background-removal').then((module) => {
    const candidate = module.removeBackground ?? module.default
    if (typeof candidate !== 'function') throw new Error('The background removal engine could not be loaded.')
    return candidate as RemoveBackgroundEngine
  })
  return enginePromise
}

function supportsWebGpu(): boolean {
  if (typeof navigator === 'undefined' || navigator.userAgent.toLowerCase().includes('firefox')) return false
  return 'gpu' in navigator
}

export function getModelPublicPath(baseUrl: string, baseUri: string): string {
  return new URL(`${baseUrl}models/background-removal/`, baseUri).toString()
}

export async function removeBackgroundWithModel(source: Blob, onProgress: ProgressHandler): Promise<Blob> {
  const engine = await loadEngine()
  const device: MlDevice = supportsWebGpu() ? 'gpu' : 'cpu'
  const config = {
    device,
    publicPath: getModelPublicPath(import.meta.env.BASE_URL, document.baseURI),
    proxyToWorker: true,
    model: 'isnet_quint8' as const,
    output: { format: 'image/png' as const, quality: 1 },
    progress: (key: string, current: number, total: number) => {
      onProgress(total > 0 ? Math.min(1, current / total) : 0, key)
    },
  }

  try {
    return await engine(source, config)
  } catch (reason: unknown) {
    if (device !== 'gpu') throw reason
    onProgress(0, 'WebGPU unavailable, switching to WASM')
    return engine(source, { ...config, device: 'cpu' })
  }
}
