import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import JSZip from 'jszip'
import {
  ACCEPTED_TYPES,
  extensionForType,
  formatBytes,
  isSupportedImage,
  loadImage,
  MAX_FILE_SIZE,
} from './lib/files'
import {
  getOutputDimensions,
  getOutputMimeType,
  getSavingsPercent,
  renderImage,
  supportsQuality,
  type Adjustments,
  type BackgroundRemoval,
  type CropRect,
  type ImageSettings,
  type OutputFormat,
  type Rotation,
} from './lib/image-processing'
import { renderImageInWorker } from './lib/worker-processing'
import { ML_MODEL_SIZE_LABEL, removeBackgroundWithModel } from './lib/ml-background-removal'
import { getSmartOptimizeSettings } from './lib/smart-optimize'
import { useI18n } from './lib/i18n'

type IconName =
  | 'arrow'
  | 'check'
  | 'chevron'
  | 'close'
  | 'compare'
  | 'download'
  | 'expand'
  | 'file'
  | 'folder'
  | 'grid'
  | 'image'
  | 'layers'
  | 'lock'
  | 'minus'
  | 'plus'
  | 'refresh'
  | 'spark'
  | 'sun'
  | 'upload'
  | 'wand'

type Tool = { id: string; label: string; icon: IconName; section: string }
type UploadedImage = {
  id: string
  file: File
  url: string
  width: number
  height: number
}
type BatchStatus = 'queued' | 'processing' | 'success' | 'failed' | 'cancelled'
type BatchItem = { id: string; name: string; status: BatchStatus; error?: string }
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const tools: Tool[] = [
  { id: 'compress', label: 'Compress', icon: 'spark', section: 'Optimize' },
  { id: 'resize', label: 'Resize', icon: 'expand', section: 'Optimize' },
  { id: 'convert', label: 'Convert', icon: 'refresh', section: 'Optimize' },
  { id: 'crop', label: 'Crop', icon: 'grid', section: 'Edit' },
  { id: 'rotate', label: 'Rotate & flip', icon: 'refresh', section: 'Edit' },
  { id: 'adjust', label: 'Adjust', icon: 'sun', section: 'Edit' },
  { id: 'remove-background', label: 'Remove background', icon: 'wand', section: 'AI' },
  { id: 'export', label: 'Export', icon: 'download', section: 'Export' },
]

const outputFormats: Array<{ value: OutputFormat; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/avif', label: 'AVIF' },
]

function initialSettings(image: UploadedImage): ImageSettings {
  return {
    width: image.width,
    height: image.height,
    maintainAspectRatio: true,
    quality: 82,
    outputFormat: 'image/webp',
    crop: { x: 0, y: 0, width: image.width, height: image.height },
    rotation: 0,
    flipX: false,
    flipY: false,
    adjustments: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, blur: 0, sharpen: 0 },
    backgroundRemoval: { enabled: false, mode: 'local', threshold: 34, softness: 8 },
  }
}

const emptySettings: ImageSettings = {
  width: 0,
  height: 0,
  maintainAspectRatio: true,
  quality: 82,
  outputFormat: 'image/webp',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  rotation: 0,
  flipX: false,
  flipY: false,
  adjustments: { brightness: 0, contrast: 0, saturation: 0, exposure: 0, blur: 0, sharpen: 0 },
  backgroundRemoval: { enabled: false, mode: 'local', threshold: 34, softness: 8 },
}

function filenameWithoutExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '')
}

function settingsForBatchImage(settings: ImageSettings, image: UploadedImage): ImageSettings {
  const x = Math.max(0, Math.min(image.width - 1, settings.crop.x))
  const y = Math.max(0, Math.min(image.height - 1, settings.crop.y))
  const crop = {
    x,
    y,
    width: Math.max(1, Math.min(image.width - x, settings.crop.width)),
    height: Math.max(1, Math.min(image.height - y, settings.crop.height)),
  }
  return { ...settings, crop }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function getInfoPage(): 'features' | 'privacy' | null {
  if (typeof window === 'undefined') return null
  const queryPage = new URLSearchParams(window.location.search).get('page')
  const page = queryPage ?? window.location.hash.slice(1)
  return page === 'features' || page === 'privacy' ? page : null
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    compare: <><path d="M12 4v16" /><path d="M7 7H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" /><path d="M17 7h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    expand: <><path d="M8 3H3v5" /><path d="M3 3l6 6" /><path d="M16 3h5v5" /><path d="m21 3-6 6" /><path d="M8 21H3v-5" /><path d="m3 21 6-6" /><path d="M16 21h5v-5" /><path d="m21 21-6-6" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    grid: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M9 4v16" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    minus: <path d="M5 12h14" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></>,
    spark: <><path d="m12 3-1.3 5.7L5 10l5.7 1.3L12 17l1.3-5.7L19 10l-5.7-1.3z" /><path d="m19 16-.5 2.5L16 19l2.5.5L19 22l.5-2.5L22 19l-2.5-.5z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    wand: <><path d="m15 4 5 5" /><path d="m13 6 5 5L8 21H3v-5z" /><path d="m4 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  }
  return <svg {...common}>{paths[name]}</svg>
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <a className={`brand ${compact ? 'brand-compact' : ''}`} href="./" aria-label="Pixora home">
    <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
    {!compact && <span>Pixora</span>}
  </a>
}

function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n()
  return <label className="language-switcher"><span>{t('language')}</span><select value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'tr')} aria-label={t('language')}><option value="en">{t('english')}</option><option value="tr">{t('turkish')}</option></select></label>
}

function App() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [infoPage, setInfoPage] = useState<'features' | 'privacy' | null>(getInfoPage)
  const [activeTool, setActiveTool] = useState('compress')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [comparison, setComparison] = useState(50)
  const [settings, setSettings] = useState<ImageSettings>(emptySettings)
  const [settingsHistory, setSettingsHistory] = useState<{ past: ImageSettings[]; future: ImageSettings[] }>({ past: [], future: [] })
  const [settingsImageId, setSettingsImageId] = useState<string | null>(null)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingError, setProcessingError] = useState('')
  const [mlProgress, setMlProgress] = useState(0)
  const [mlStage, setMlStage] = useState('')
  const [exportName, setExportName] = useState('')
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [batchProgress, setBatchProgress] = useState(0)
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchError, setBatchError] = useState('')
  const batchController = useRef<AbortController | null>(null)
  const processedUrlRef = useRef<string | null>(null)
  const imagesRef = useRef<UploadedImage[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const activeImage = images.find((image) => image.id === activeId) ?? images[0]

  useEffect(() => {
    const onHashChange = () => setInfoPage(getInfoPage())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!activeImage) return
    setSettings(initialSettings(activeImage))
    setSettingsHistory({ past: [], future: [] })
    setSettingsImageId(activeImage.id)
    setExportName(filenameWithoutExtension(activeImage.file.name))
    setComparison(50)
    setMlProgress(0)
    setMlStage('')
  }, [activeImage?.id])

  useEffect(() => {
    if (!activeImage || settingsImageId !== activeImage.id || !settings.width || !settings.height) return
    let cancelled = false
    setIsProcessing(true)
    setProcessingError('')
    setMlProgress(settings.backgroundRemoval.mode === 'ml' ? 0 : 1)
    setMlStage(settings.backgroundRemoval.mode === 'ml' ? 'Preparing local model' : '')
    const renderSettings = settings.backgroundRemoval.mode === 'ml'
      ? { ...settings, outputFormat: 'image/png' as const, backgroundRemoval: { ...settings.backgroundRemoval, enabled: false } }
      : settings
    const renderTask = renderImage(activeImage.url, activeImage.file.type, renderSettings)
      .then((blob) => settings.backgroundRemoval.enabled && settings.backgroundRemoval.mode === 'ml'
        ? removeBackgroundWithModel(blob, (progress, stage) => {
          if (!cancelled) {
            setMlProgress(progress)
            setMlStage(stage)
          }
        })
        : blob)
    void renderTask
      .then((blob) => {
        if (cancelled) return
        const nextUrl = URL.createObjectURL(blob)
        if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current)
        processedUrlRef.current = nextUrl
        setProcessedUrl(nextUrl)
        setOutputBlob(blob)
        setIsProcessing(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setOutputBlob(null)
        setIsProcessing(false)
        setProcessingError(reason instanceof Error ? reason.message : 'The image could not be processed in this browser.')
        setMlStage('')
      })
    return () => { cancelled = true }
  }, [activeImage, settings, settingsImageId])

  useEffect(() => () => {
    if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current)
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    setError('')
    const nextImages: UploadedImage[] = []
    for (const file of files) {
      if (!isSupportedImage(file)) {
        setError(`${file.name} is not supported. Choose PNG, JPG, WebP, or AVIF.`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} is larger than 25 MB and cannot be processed safely in the browser.`)
        continue
      }
      try {
        const image = await loadImage(file)
        nextImages.push({ id: `${file.name}-${file.lastModified}-${Math.random()}`, file, ...image })
      } catch {
        setError(`${file.name} could not be decoded by this browser.`)
      }
    }
    if (nextImages.length) {
      setImages((current) => {
        const next = [...current, ...nextImages]
        imagesRef.current = next
        return next
      })
      setActiveId((current) => current ?? nextImages[0].id)
    }
  }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pastedImages = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
      if (pastedImages.length) void addFiles(pastedImages)
    }
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('paste', onPaste)
    }
  }, [addFiles])

  useEffect(() => () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url))
  }, [])

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(Array.from(event.target.files))
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    void addFiles(Array.from(event.dataTransfer.files))
  }

  function resetProject() {
    batchController.current?.abort()
    images.forEach((image) => URL.revokeObjectURL(image.url))
    imagesRef.current = []
    setImages([])
    setActiveId(null)
    setError('')
    setZoom(1)
    setSettingsImageId(null)
    setSettingsHistory({ past: [], future: [] })
    setOutputBlob(null)
    setProcessedUrl(null)
    setProcessingError('')
    setBatchItems([])
    setBatchProgress(0)
    setBatchProcessing(false)
    setBatchError('')
    if (processedUrlRef.current) {
      URL.revokeObjectURL(processedUrlRef.current)
      processedUrlRef.current = null
    }
  }

  function commitSettings(updater: (current: ImageSettings) => ImageSettings) {
    setSettings((current) => {
      const next = updater(current)
      if (JSON.stringify(current) === JSON.stringify(next)) return current
      setSettingsHistory((history) => ({ past: [...history.past, current].slice(-50), future: [] }))
      return next
    })
  }

  function updateSettings(patch: Partial<ImageSettings>) {
    commitSettings((current) => ({ ...current, ...patch }))
  }

  function updateDimension(field: 'width' | 'height', value: number) {
    if (!activeImage) return
    const nextValue = Math.max(1, Math.round(value) || 1)
    commitSettings((current) => {
      if (!current.maintainAspectRatio) return { ...current, [field]: nextValue }
      if (field === 'width') return { ...current, width: nextValue, height: Math.max(1, Math.round(nextValue * activeImage.height / activeImage.width)) }
      return { ...current, height: nextValue, width: Math.max(1, Math.round(nextValue * activeImage.width / activeImage.height)) }
    })
  }

  function updateScale(percent: number) {
    if (!activeImage) return
    const scale = percent / 100
    commitSettings((current) => ({ ...current, width: Math.max(1, Math.round(activeImage.width * scale)), height: Math.max(1, Math.round(activeImage.height * scale)) }))
  }

  function updateCrop(patch: Partial<CropRect>) {
    if (!activeImage) return
    commitSettings((current) => {
      const nextX = Math.max(0, Math.min(activeImage.width - 1, Math.round(patch.x ?? current.crop.x)))
      const nextY = Math.max(0, Math.min(activeImage.height - 1, Math.round(patch.y ?? current.crop.y)))
      const nextWidth = Math.max(1, Math.min(activeImage.width - nextX, Math.round(patch.width ?? current.crop.width)))
      const nextHeight = Math.max(1, Math.min(activeImage.height - nextY, Math.round(patch.height ?? current.crop.height)))
      return { ...current, width: nextWidth, height: nextHeight, crop: { x: nextX, y: nextY, width: nextWidth, height: nextHeight } }
    })
  }

  function applyCropAspect(aspect: number | null) {
    if (!activeImage) return
    if (aspect === null) {
      updateCrop({ x: 0, y: 0, width: activeImage.width, height: activeImage.height })
      return
    }
    const sourceRatio = activeImage.width / activeImage.height
    const width = sourceRatio >= aspect ? Math.round(activeImage.height * aspect) : activeImage.width
    const height = sourceRatio >= aspect ? activeImage.height : Math.round(activeImage.width / aspect)
    updateCrop({ x: Math.round((activeImage.width - width) / 2), y: Math.round((activeImage.height - height) / 2), width, height })
  }

  const undo = useCallback(() => {
    setSettingsHistory((history) => {
      const previous = history.past.at(-1)
      if (!previous) return history
      setSettings(previous)
      return { past: history.past.slice(0, -1), future: [settings, ...history.future] }
    })
  }, [settings])

  const redo = useCallback(() => {
    setSettingsHistory((history) => {
      const next = history.future[0]
      if (!next) return history
      setSettings(next)
      return { past: [...history.past, settings], future: history.future.slice(1) }
    })
  }, [settings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  function smartOptimize() {
    commitSettings((current) => getSmartOptimizeSettings(current))
    setActiveTool('compress')
  }

  function exportImage() {
    if (!outputBlob || isProcessing) return
    const mimeType = settings.backgroundRemoval.enabled && settings.backgroundRemoval.mode === 'ml' ? 'image/png' : getOutputMimeType(settings.outputFormat, activeImage.file.type)
    const extension = extensionForType(mimeType).toLowerCase()
    const safeName = exportName.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'pixora-export'
    downloadBlob(outputBlob, `${safeName}.${extension}`)
  }

  async function exportBatch() {
    if (batchProcessing || images.length < 2) return
    const controller = new AbortController()
    batchController.current = controller
    setBatchProcessing(true)
    setBatchError('')
    setBatchProgress(0)
    setBatchItems(images.map((image) => ({ id: image.id, name: image.file.name, status: 'queued' })))
    const zip = new JSZip()
    let completed = 0

    for (const image of images) {
      if (controller.signal.aborted) break
      setBatchItems((current) => current.map((item) => item.id === image.id ? { ...item, status: 'processing' } : item))
      try {
        const imageSettings = settingsForBatchImage(settings, image)
        const renderSettings = imageSettings.backgroundRemoval.mode === 'ml'
          ? { ...imageSettings, outputFormat: 'image/png' as const, backgroundRemoval: { ...imageSettings.backgroundRemoval, enabled: false } }
          : imageSettings
        const renderedBlob = await renderImageInWorker(image.file, renderSettings, controller.signal)
        const blob = imageSettings.backgroundRemoval.enabled && imageSettings.backgroundRemoval.mode === 'ml'
          ? await removeBackgroundWithModel(renderedBlob, (progress) => setBatchProgress(Math.round((completed + progress) / images.length * 100)))
          : renderedBlob
        const mimeType = imageSettings.backgroundRemoval.enabled && imageSettings.backgroundRemoval.mode === 'ml' ? 'image/png' : getOutputMimeType(imageSettings.outputFormat, image.file.type)
        const extension = extensionForType(mimeType).toLowerCase()
        const name = `${filenameWithoutExtension(image.file.name)}.${extension}`
        zip.file(name, blob)
        completed += 1
        setBatchProgress(Math.round(completed / images.length * 100))
        setBatchItems((current) => current.map((item) => item.id === image.id ? { ...item, status: 'success' } : item))
      } catch (reason: unknown) {
        if (reason instanceof DOMException && reason.name === 'AbortError') {
          setBatchItems((current) => current.map((item) => item.status === 'queued' || item.status === 'processing' ? { ...item, status: 'cancelled' } : item))
          setBatchError('Batch processing was cancelled.')
          setBatchProcessing(false)
          batchController.current = null
          return
        }
        const message = reason instanceof Error ? reason.message : 'This image could not be processed.'
        setBatchItems((current) => current.map((item) => item.id === image.id ? { ...item, status: 'failed', error: message } : item))
        setBatchError('Some images could not be processed. You can still download the successful files.')
      }
    }

    if (!controller.signal.aborted && completed > 0) {
      try {
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
        downloadBlob(zipBlob, 'pixora-export.zip')
      } catch {
        setBatchError('The ZIP file could not be created in this browser.')
      }
    }
    setBatchProcessing(false)
    batchController.current = null
  }

  function cancelBatch() {
    batchController.current?.abort()
  }

  if (!activeImage) {
    if (infoPage) return <InfoPage page={infoPage} />
    return <Landing error={error} isDragging={isDragging} fileInput={fileInput} onFileChange={onFileChange} onDrop={onDrop} onDragState={setIsDragging} />
  }

  return <Workspace
    images={images}
    activeImage={activeImage}
    activeTool={activeTool}
    batchError={batchError}
    batchItems={batchItems}
    batchProcessing={batchProcessing}
    batchProgress={batchProgress}
    comparison={comparison}
    error={error}
    fileInput={fileInput}
    exportName={exportName}
    isProcessing={isProcessing}
    outputBlob={outputBlob}
    processedUrl={processedUrl}
    processingError={processingError}
    mlProgress={mlProgress}
    mlStage={mlStage}
    settings={settings}
    zoom={zoom}
    onComparisonChange={setComparison}
    onCancelBatch={cancelBatch}
    onCropAspectChange={applyCropAspect}
    onCropChange={updateCrop}
    onFileChange={onFileChange}
    onReset={resetProject}
    onExport={exportImage}
    onExportBatch={() => void exportBatch()}
    onRedo={redo}
    onExportNameChange={setExportName}
    onScaleChange={updateScale}
    onSettingsChange={updateSettings}
    onSmartOptimize={smartOptimize}
    onUndo={undo}
    canRedo={settingsHistory.future.length > 0}
    canUndo={settingsHistory.past.length > 0}
    onRotationChange={(rotation) => updateSettings({ rotation })}
    onDimensionChange={updateDimension}
    onSelectImage={setActiveId}
    onSelectTool={setActiveTool}
    onZoomChange={setZoom}
  />
}

type UploadProps = {
  error: string
  isDragging: boolean
  fileInput: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onDragState: (dragging: boolean) => void
}

function UploadZone({ error, isDragging, fileInput, onFileChange, onDrop, onDragState }: UploadProps) {
  const { t } = useI18n()
  return <>
    <div
      id="upload-area"
      className={`upload-zone ${isDragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); onDragState(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => onDragState(false)}
      onDrop={onDrop}
    >
      <div className="upload-icon"><Icon name="upload" size={22} /></div>
      <strong>{t('dropImages')}</strong>
      <span>{t('chooseFromDevice')}</span>
      <button className="button button-primary" type="button" onClick={() => fileInput.current?.click()}>
        <Icon name="folder" size={16} /> {t('chooseImages')}
      </button>
      <small>{t('supportedUpload')} <i /> Up to 25 MB each</small>
    </div>
    {error && <p className="error-message" role="alert"><Icon name="close" size={15} /> {error}</p>}
    <input ref={fileInput} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(',')} multiple onChange={onFileChange} />
  </>
}

function Landing(props: UploadProps) {
  const { t } = useI18n()
  return <main className="landing-shell">
    <a className="skip-link" href="#upload-area">Skip to image upload</a>
    <header className="landing-nav">
      <Logo />
      <nav className="nav-links" aria-label="Main navigation">
        <a href="./?page=features">{t('features')}</a>
        <a href="./?page=privacy">{t('privacy')}</a>
        <a href="https://github.com/padrosum" target="_blank" rel="noreferrer">{t('github')} <Icon name="arrow" size={14} /></a>
        <a className="nav-site-button" href="https://padrosum.uk" target="_blank" rel="noreferrer">{t('website')} <Icon name="arrow" size={13} /></a>
      </nav>
      <div className="landing-nav-actions"><LanguageSwitcher /><span className="local-pill"><span /> {t('local')}</span></div>
    </header>
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-line" /> {t('eyebrow')}</p>
        <h1 id="hero-title">{t('heroTitle')}<br /><em>{t('heroTitleAccent')}</em></h1>
        <p className="hero-description">{t('heroDescription')}</p>
        <div className="hero-actions">
          <button className="button button-primary button-large" type="button" onClick={() => props.fileInput.current?.click()}>{t('chooseImage')} <Icon name="arrow" size={17} /></button>
          <a className="button button-secondary button-large" href="https://padrosum.uk" target="_blank" rel="noreferrer">{t('visitWebsite')} <Icon name="arrow" size={17} /></a>
          <button className="button button-ghost button-large" type="button" onClick={() => props.fileInput.current?.click()}>{t('tryDemo')} <span className="shortcut">⌘ K</span></button>
        </div>
        <div className="trust-row"><Icon name="lock" size={15} /><span>{t('trust')}</span><span className="trust-divider" /> <span>{t('freeForever')}</span></div>
      </div>
      <div className="hero-upload-wrap">
        <div className="hero-glow" />
        <div className="format-card format-card-top"><span className="format-dot dot-lime" /><span>Local processing</span><strong>0 uploads</strong></div>
        <UploadZone {...props} />
        <div className="format-card format-card-bottom"><span className="mini-stack"><i /><i /><i /></span><span>Works with your files</span><strong>PNG · JPG · AVIF</strong></div>
      </div>
    </section>
    <section className="landing-footer">
      <div className="footer-note"><span className="section-number">01</span><span>{t('workspaceFooter')}</span></div>
      <div className="supported-formats"><span>{t('supportedFormats')}</span><strong>PNG</strong><strong>JPEG</strong><strong>WebP</strong><strong>AVIF</strong></div>
    </section>
  </main>
}

function InfoPage({ page }: { page: 'features' | 'privacy' }) {
  const { t } = useI18n()
  const isFeatures = page === 'features'
  return <main className="info-page">
    <header className="landing-nav info-nav">
      <Logo />
      <nav className="nav-links" aria-label="Information navigation">
        <a className={isFeatures ? 'is-current' : ''} href="./?page=features">{t('features')}</a>
        <a className={!isFeatures ? 'is-current' : ''} href="./?page=privacy">{t('privacy')}</a>
        <a href="https://github.com/padrosum" target="_blank" rel="noreferrer">{t('github')} <Icon name="arrow" size={14} /></a>
      </nav>
      <div className="info-nav-actions"><LanguageSwitcher /><a className="button button-secondary info-back" href="./">{t('openPixora')} <Icon name="arrow" size={14} /></a></div>
    </header>
    <section className="info-hero" aria-labelledby="info-title">
      <a className="info-back-link" href="./"><Icon name="arrow" size={14} /> {t('backWorkspace')}</a>
      <p className="eyebrow"><span className="eyebrow-line" /> Pixora / {isFeatures ? t('features') : t('privacy')}</p>
      <h1 id="info-title">{isFeatures ? <>{t('featuresPageTitle')}<br /><em>{t('featuresPageAccent')}</em></> : <>{t('privacyPageTitle')}<br /><em>{t('privacyPageAccent')}</em></>}</h1>
      <p className="info-lead">{isFeatures ? t('featuresLead') : t('privacyLead')}</p>
    </section>
    {isFeatures ? <section className="info-grid" aria-label="Pixora features">
      <InfoCard index="01" title={t('featureOptimize')} text={t('featureOptimizeText')} icon="spark" />
      <InfoCard index="02" title={t('featureEdit')} text={t('featureEditText')} icon="grid" />
      <InfoCard index="03" title={t('featureBatch')} text={t('featureBatchText')} icon="layers" />
      <InfoCard index="04" title={t('featureAi')} text={t('featureAiText')} icon="wand" />
      <InfoCard index="05" title={t('featureOffline')} text={t('featureOfflineText')} icon="lock" />
      <InfoCard index="06" title={t('featureFree')} text={t('featureFreeText')} icon="check" />
    </section> : <section className="privacy-content" aria-label="Pixora privacy policy">
      <div className="privacy-statement"><span className="privacy-mark"><Icon name="lock" size={22} /></span><div><p className="section-kicker">{t('privacyShort')}</p><h2>{t('privacyShortTitle')}</h2><p>{t('privacyShortText')}</p></div></div>
      <div className="privacy-columns"><div><p className="section-kicker">{t('whatPixoraDoes')}</p><ul><li>{t('privacyDoes1')}</li><li>{t('privacyDoes2')}</li><li>{t('privacyDoes3')}</li><li>{t('privacyDoes4')}</li></ul></div><div><p className="section-kicker">{t('whatPixoraDoesNot')}</p><ul><li>{t('privacyNot1')}</li><li>{t('privacyNot2')}</li><li>{t('privacyNot3')}</li><li>{t('privacyNot4')}</li></ul></div></div>
      <div className="privacy-note"><Icon name="spark" size={17} /><p>{t('aiPrivacyNote')}</p></div>
    </section>}
    <footer className="info-footer"><span>{t('freeSoftwareNotice')}</span><a href="https://github.com/padrosum" target="_blank" rel="noreferrer">github.com/padrosum <Icon name="arrow" size={13} /></a><a href="https://padrosum.uk" target="_blank" rel="noreferrer">padrosum.uk <Icon name="arrow" size={13} /></a></footer>
  </main>
}

function InfoCard({ index, title, text, icon }: { index: string; title: string; text: string; icon: IconName }) {
  return <article className="info-card"><div className="info-card-top"><span>{index}</span><Icon name={icon} size={18} /></div><h2>{title}</h2><p>{text}</p></article>
}

type WorkspaceProps = {
  images: UploadedImage[]
  activeImage: UploadedImage
  activeTool: string
  batchError: string
  batchItems: BatchItem[]
  batchProcessing: boolean
  batchProgress: number
  canRedo: boolean
  canUndo: boolean
  comparison: number
  error: string
  exportName: string
  fileInput: RefObject<HTMLInputElement | null>
  isProcessing: boolean
  outputBlob: Blob | null
  processedUrl: string | null
  processingError: string
  mlProgress: number
  mlStage: string
  settings: ImageSettings
  zoom: number
  onComparisonChange: (value: number) => void
  onCropAspectChange: (aspect: number | null) => void
  onCropChange: (patch: Partial<CropRect>) => void
  onDimensionChange: (field: 'width' | 'height', value: number) => void
  onCancelBatch: () => void
  onExport: () => void
  onExportBatch: () => void
  onRedo: () => void
  onExportNameChange: (name: string) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onReset: () => void
  onScaleChange: (percent: number) => void
  onSettingsChange: (patch: Partial<ImageSettings>) => void
  onSmartOptimize: () => void
  onUndo: () => void
  onRotationChange: (rotation: Rotation) => void
  onSelectImage: (id: string) => void
  onSelectTool: (id: string) => void
  onZoomChange: (value: number) => void
}

function Workspace({ images, activeImage, activeTool, batchError, batchItems, batchProcessing, batchProgress, canRedo, canUndo, comparison, error, exportName, fileInput, isProcessing, outputBlob, processedUrl, processingError, mlProgress, mlStage, settings, zoom, onComparisonChange, onCropAspectChange, onCropChange, onDimensionChange, onCancelBatch, onExport, onExportBatch, onExportNameChange, onFileChange, onReset, onRedo, onScaleChange, onSettingsChange, onRotationChange, onSelectImage, onSelectTool, onSmartOptimize, onUndo, onZoomChange }: WorkspaceProps) {
  const { t } = useI18n()
  const currentTool = tools.find((tool) => tool.id === activeTool) ?? tools[0]
  const sections = [...new Set(tools.map((tool) => tool.section))]
  const previewUrl = activeTool === 'crop' ? activeImage.url : processedUrl ?? activeImage.url
  const outputSize = outputBlob ? formatBytes(outputBlob.size) : isProcessing ? 'Processing...' : '—'
  const savings = outputBlob ? getSavingsPercent(activeImage.file.size, outputBlob.size) : null
  const outputDimensions = getOutputDimensions(settings)
  const outputMimeType = settings.backgroundRemoval.enabled && settings.backgroundRemoval.mode === 'ml' ? 'image/png' : getOutputMimeType(settings.outputFormat, activeImage.file.type)
  const translatedTool = t(currentTool.id)
  return <main className="workspace-shell">
    <a className="skip-link" href="#workspace-canvas">Skip to image canvas</a>
    <header className="workspace-topbar">
      <Logo compact />
      <div className="project-breadcrumb"><span>{t('projects')}</span><Icon name="chevron" size={13} /><strong>{t('untitled')}</strong></div>
      <div className="topbar-actions">
        <span className="saved-status"><span /> {t('savedLocally')}</span>
        <button className="icon-button" aria-label="Undo" type="button" disabled={!canUndo} onClick={onUndo}><Icon name="refresh" size={17} /></button>
        <button className="icon-button redo-button" aria-label="Redo" type="button" disabled={!canRedo} onClick={onRedo}><Icon name="refresh" size={17} /></button>
        <LanguageSwitcher /><button className="button button-secondary" type="button" onClick={onReset}>{t('newProject')} <span className="shortcut">⌘ N</span></button>
      </div>
    </header>
    <div className="workspace-body">
      <aside className="tool-sidebar" aria-label="Image tools">
        <div className="sidebar-label">{t('tools')}</div>
        {sections.map((section) => <div className="tool-group" key={section}>
          <span className="tool-section-label">{t(section.toLowerCase())}</span>
          {tools.filter((tool) => tool.section === section).map((tool) => <button key={tool.id} className={`tool-button ${activeTool === tool.id ? 'is-active' : ''}`} aria-pressed={activeTool === tool.id} onClick={() => onSelectTool(tool.id)} type="button">
            <Icon name={tool.icon} size={17} /><span>{t(tool.id)}</span>{tool.id === 'remove-background' && <small>ML</small>}
          </button>)}
        </div>)}
        <div className="sidebar-bottom"><div className="privacy-card"><Icon name="lock" size={15} /><span><strong>{t('privateByDesign')}</strong><small>{t('nothingLeaves')}</small></span></div></div>
      </aside>
      <section id="workspace-canvas" className="canvas-panel" aria-label="Image preview" aria-busy={isProcessing}>
        <div className="canvas-toolbar">
          <div className="image-tabs">
            {images.map((image, index) => <button key={image.id} className={`image-tab ${image.id === activeImage.id ? 'is-active' : ''}`} aria-label={`Select ${image.file.name}`} aria-pressed={image.id === activeImage.id} onClick={() => onSelectImage(image.id)} type="button" title={image.file.name}>
              <img src={image.url} alt="" /><span>{index + 1}</span>
            </button>)}
            <button className="add-image-button" type="button" aria-label="Add images" onClick={() => fileInput.current?.click()}><Icon name="plus" size={16} /></button>
          </div>
          <div className="canvas-controls"><button className="icon-button" aria-label="Zoom out" type="button" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}><Icon name="minus" size={16} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" type="button" onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}><Icon name="plus" size={16} /></button><span className="control-divider" /><button className="view-button" type="button" onClick={() => onZoomChange(1)}>Fit <Icon name="chevron" size={13} /></button></div>
          </div>
          <div className="canvas-stage checkerboard">
            <div className="image-frame" style={{ transform: `scale(${zoom})` }}>
              <img className="preview-image" src={previewUrl} alt={activeImage.file.name} />
              <div className="comparison-overlay" style={{ width: `${comparison}%` }}><img className="preview-image" src={activeImage.url} alt="Original image comparison" /></div>
              <div className="comparison-handle" style={{ left: `${comparison}%` }}><span><Icon name="compare" size={14} /></span></div>
              {activeTool === 'crop' && <CropOverlay crop={settings.crop} imageWidth={activeImage.width} imageHeight={activeImage.height} onCropChange={onCropChange} />}
            </div>
            <label className="comparison-control"><span>{t('original')}</span><input type="range" min="0" max="100" value={comparison} onChange={(event) => onComparisonChange(Number(event.target.value))} aria-label="Before and after comparison" /><span>{t('preview')}</span></label>
          </div>
          <div className="canvas-footer"><span><Icon name="image" size={14} /> {outputDimensions.width} × {outputDimensions.height}px</span><span className="footer-dot" /><span>{extensionForType(outputMimeType)}</span><span className="footer-dot" /><span>{outputSize}</span>{savings !== null && <><span className="footer-dot" /><span className="savings-text">-{savings}%</span></>}</div>
        </section>
      <aside className="settings-panel" aria-label={`${translatedTool} settings`}>
        <div className="settings-heading"><div><span className="settings-kicker">{t(currentTool.section.toLowerCase())}</span><h2>{translatedTool}</h2></div><span className="panel-indicator" aria-hidden="true"><Icon name="layers" size={15} /></span></div>
        {activeTool === 'compress' && <CompressSettings settings={settings} outputSize={outputSize} activeImage={activeImage} onSettingsChange={onSettingsChange} onSmartOptimize={onSmartOptimize} />}
        {activeTool === 'resize' && <ResizeSettings settings={settings} onDimensionChange={onDimensionChange} onScaleChange={onScaleChange} onSettingsChange={onSettingsChange} />}
        {activeTool === 'convert' && <ConvertSettings settings={settings} onSettingsChange={onSettingsChange} />}
        {activeTool === 'crop' && <CropSettings crop={settings.crop} onCropAspectChange={onCropAspectChange} onCropChange={onCropChange} />}
        {activeTool === 'rotate' && <RotateSettings settings={settings} onRotationChange={onRotationChange} onSettingsChange={onSettingsChange} />}
        {activeTool === 'adjust' && <AdjustSettings adjustments={settings.adjustments} onAdjustmentChange={(patch) => onSettingsChange({ adjustments: { ...settings.adjustments, ...patch } })} />}
        {activeTool === 'remove-background' && <BackgroundSettings backgroundRemoval={settings.backgroundRemoval} isProcessing={isProcessing} mlProgress={mlProgress} mlStage={mlStage} onBackgroundChange={(patch) => onSettingsChange({ outputFormat: patch.mode === 'ml' ? 'image/png' : settings.outputFormat, backgroundRemoval: { ...settings.backgroundRemoval, ...patch } })} />}
        {activeTool === 'export' && <ExportSettings exportName={exportName} onExportNameChange={onExportNameChange} settings={settings} onSettingsChange={onSettingsChange} />}
        {!['compress', 'resize', 'convert', 'crop', 'rotate', 'adjust', 'remove-background', 'export'].includes(activeTool) && <ToolPlaceholder tool={currentTool} />}
        {processingError && <p className="processing-error" role="alert" aria-live="assertive"><Icon name="close" size={14} /> {processingError}</p>}
        {images.length > 1 && <BatchQueue items={batchItems} progress={batchProgress} isProcessing={batchProcessing} error={batchError} onCancel={onCancelBatch} />}
        <div className="settings-export"><div className="output-line"><span>{t('optimizedSize')}</span><strong>{outputSize}</strong></div><button className="button button-primary export-button" type="button" disabled={!outputBlob || isProcessing} onClick={onExport}><Icon name="download" size={16} /> {isProcessing ? t('processing') : t('exportImage')} <Icon name="arrow" size={15} /></button><p>{t('processingLocally')}</p></div>
        {images.length > 1 && <button className="button button-secondary batch-export-button" type="button" disabled={batchProcessing} onClick={onExportBatch}><Icon name="layers" size={16} /> {batchProcessing ? `${t('processing')} ${batchProgress}%` : t('downloadZip')}</button>}
      </aside>
    </div>
    {error && <div className="workspace-error" role="alert" aria-live="assertive"><Icon name="close" size={15} /> {error}</div>}
    <input ref={fileInput} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(',')} multiple onChange={onFileChange} />
    <button className="mobile-add" type="button" onClick={() => fileInput.current?.click()} aria-label="Add image"><Icon name="plus" size={21} /></button>
  </main>
}

function CropOverlay({ crop, imageWidth, imageHeight, onCropChange }: { crop: CropRect; imageWidth: number; imageHeight: number; onCropChange: (patch: Partial<CropRect>) => void }) {
  const drag = useRef<{ handle: CropHandle; startX: number; startY: number; startCrop: CropRect } | null>(null)
  const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const cropStyle = { left: `${crop.x / imageWidth * 100}%`, top: `${crop.y / imageHeight * 100}%`, width: `${crop.width / imageWidth * 100}%`, height: `${crop.height / imageHeight * 100}%` }

  function startDrag(event: PointerEvent<HTMLButtonElement>, handle: CropHandle) {
    event.preventDefault()
    event.stopPropagation()
    drag.current = { handle, startX: event.clientX, startY: event.clientY, startCrop: crop }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const surface = event.currentTarget.getBoundingClientRect()
    const deltaX = (event.clientX - drag.current.startX) / surface.width * imageWidth
    const deltaY = (event.clientY - drag.current.startY) / surface.height * imageHeight
    const start = drag.current.startCrop
    let left = start.x
    let top = start.y
    let right = start.x + start.width
    let bottom = start.y + start.height
    const handle = drag.current.handle
    if (handle.includes('w')) left = Math.max(0, Math.min(right - 1, start.x + deltaX))
    if (handle.includes('e')) right = Math.min(imageWidth, Math.max(left + 1, start.x + start.width + deltaX))
    if (handle.includes('n')) top = Math.max(0, Math.min(bottom - 1, start.y + deltaY))
    if (handle.includes('s')) bottom = Math.min(imageHeight, Math.max(top + 1, start.y + start.height + deltaY))
    onCropChange({ x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) })
  }

  function endDrag() {
    drag.current = null
  }

  return <div className="crop-interaction-surface" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <div className="crop-box" style={cropStyle}>
      <div className="crop-grid-lines" aria-hidden="true" />
      {handles.map((handle) => <button key={handle} className={`crop-handle crop-handle-${handle}`} data-testid={`crop-handle-${handle}`} aria-label={`Resize crop ${handle}`} type="button" onPointerDown={(event) => startDrag(event, handle)} />)}
    </div>
  </div>
}

function FormatOptions({ settings, onSettingsChange }: { settings: ImageSettings; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const mlRequiresPng = settings.backgroundRemoval.enabled && settings.backgroundRemoval.mode === 'ml'
  const { t } = useI18n()
  return <>
    <span className="field-label">{t('outputFormat')}</span>
    <div className="format-options format-options-wide">
      {outputFormats.map((format) => <button key={format.value} className={`format-option ${settings.outputFormat === format.value ? 'is-selected' : ''}`} type="button" disabled={mlRequiresPng && format.value !== 'image/png'} onClick={() => onSettingsChange({ outputFormat: format.value })} aria-pressed={settings.outputFormat === format.value}>
        {format.value === 'original' ? t('original') : format.label}{settings.outputFormat === format.value && <Icon name="check" size={14} />}
      </button>)}
    </div>
  </>
}

function QualityControl({ settings, onSettingsChange }: { settings: ImageSettings; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const { t } = useI18n()
  if (!supportsQuality(settings.outputFormat)) return null
  const qualityDescription = settings.quality < 60 ? t('smallerFile') : settings.quality > 88 ? t('higherQuality') : t('balanced')
  return <>
    <label className="field-label" htmlFor="quality">{t('quality')} <span>{qualityDescription}</span></label>
    <div className="quality-row"><input id="quality" type="range" min="1" max="100" value={settings.quality} onChange={(event) => onSettingsChange({ quality: Number(event.target.value) })} /><strong>{settings.quality}</strong></div>
    <div className="quality-scale"><span>{t('smallerFile')}</span><span>{t('higherQuality')}</span></div>
  </>
}

function CompressSettings({ settings, outputSize, activeImage, onSettingsChange, onSmartOptimize }: { settings: ImageSettings; outputSize: string; activeImage: UploadedImage; onSettingsChange: (patch: Partial<ImageSettings>) => void; onSmartOptimize: () => void }) {
  const { t } = useI18n()
  return <div className="settings-content">
    <p className="settings-intro">{t('compressIntro')}</p>
    <button className="smart-optimize-button" type="button" onClick={onSmartOptimize}><Icon name="spark" size={15} /><span><strong>{t('smartOptimize')}</strong><small>{t('smartOptimizeHint')}</small></span><Icon name="arrow" size={14} /></button>
    <QualityControl settings={settings} onSettingsChange={onSettingsChange} />
    <div className="setting-divider" />
    <FormatOptions settings={settings} onSettingsChange={onSettingsChange} />
    <div className="setting-divider" />
    <div className="info-row"><span>{t('originalSize')}</span><strong>{formatBytes(activeImage.file.size)}</strong></div>
    <div className="info-row"><span>{t('optimizedSize')}</span><strong>{outputSize}</strong></div>
  </div>
}

function ResizeSettings({ settings, onDimensionChange, onScaleChange, onSettingsChange }: { settings: ImageSettings; onDimensionChange: (field: 'width' | 'height', value: number) => void; onScaleChange: (percent: number) => void; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const { t } = useI18n()
  const presets = [25, 50, 75, 100]
  return <div className="settings-content">
    <p className="settings-intro">{t('resizeIntro')}</p>
    <div className="dimension-grid">
      <label className="dimension-field">{t('width')} <input type="number" min="1" value={settings.width} onChange={(event) => onDimensionChange('width', Number(event.target.value))} /><span>px</span></label>
      <label className="dimension-field">{t('height')} <input type="number" min="1" value={settings.height} onChange={(event) => onDimensionChange('height', Number(event.target.value))} /><span>px</span></label>
    </div>
    <button className={`lock-toggle ${settings.maintainAspectRatio ? 'is-locked' : ''}`} type="button" onClick={() => onSettingsChange({ maintainAspectRatio: !settings.maintainAspectRatio })}><Icon name="lock" size={14} /> {t('aspectRatio')}</button>
    <div className="setting-divider" />
    <span className="field-label">{t('scale')}</span>
    <div className="preset-options">{presets.map((preset) => <button key={preset} className="preset-button" type="button" onClick={() => onScaleChange(preset)}>{preset}%</button>)}</div>
    <div className="preset-options preset-pixels"><button type="button" onClick={() => onDimensionChange('width', 1920)}>1920px</button><button type="button" onClick={() => onDimensionChange('width', 1280)}>1280px</button><button type="button" onClick={() => onDimensionChange('width', 720)}>720px</button></div>
  </div>
}

function ConvertSettings({ settings, onSettingsChange }: { settings: ImageSettings; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const { t } = useI18n()
  return <div className="settings-content">
    <p className="settings-intro">{t('outputFormat')}</p>
    <FormatOptions settings={settings} onSettingsChange={onSettingsChange} />
    <div className="setting-divider" />
    <QualityControl settings={settings} onSettingsChange={onSettingsChange} />
  </div>
}

function ExportSettings({ exportName, settings, onExportNameChange, onSettingsChange }: { exportName: string; settings: ImageSettings; onExportNameChange: (name: string) => void; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const { t } = useI18n()
  return <div className="settings-content">
    <p className="settings-intro">{t('exportImage')}</p>
    <label className="field-label" htmlFor="filename">{t('filename')}</label>
    <input className="text-input" id="filename" value={exportName} onChange={(event) => onExportNameChange(event.target.value)} />
    <div className="metadata-clean-card" data-testid="metadata-status"><Icon name="check" size={15} /><span><strong>{t('metadataCleaned')}</strong><small>{t('metadataDescription')}</small></span></div>
    <div className="setting-divider" />
    <FormatOptions settings={settings} onSettingsChange={onSettingsChange} />
    <div className="setting-divider" />
    <QualityControl settings={settings} onSettingsChange={onSettingsChange} />
  </div>
}

function CropSettings({ crop, onCropAspectChange, onCropChange }: { crop: CropRect; onCropAspectChange: (aspect: number | null) => void; onCropChange: (patch: Partial<CropRect>) => void }) {
  const { t } = useI18n()
  const ratios: Array<{ label: string; value: number | null }> = [
    { label: 'Free', value: null },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '16:9', value: 16 / 9 },
    { label: '3:2', value: 3 / 2 },
  ]
  return <div className="settings-content">
    <p className="settings-intro">{t('cropIntro')}</p>
    <span className="field-label">{t('aspectRatio')}</span>
    <div className="preset-options crop-ratios">{ratios.map((ratio) => <button key={ratio.label} type="button" onClick={() => onCropAspectChange(ratio.value)}>{ratio.label}</button>)}</div>
    <div className="setting-divider" />
    <div className="dimension-grid crop-fields">
      <label className="dimension-field">X <input type="number" min="0" value={crop.x} onChange={(event) => onCropChange({ x: Number(event.target.value) })} /><span>px</span></label>
      <label className="dimension-field">Y <input type="number" min="0" value={crop.y} onChange={(event) => onCropChange({ y: Number(event.target.value) })} /><span>px</span></label>
      <label className="dimension-field">{t('width')} <input type="number" min="1" value={crop.width} onChange={(event) => onCropChange({ width: Number(event.target.value) })} /><span>px</span></label>
      <label className="dimension-field">{t('height')} <input type="number" min="1" value={crop.height} onChange={(event) => onCropChange({ height: Number(event.target.value) })} /><span>px</span></label>
    </div>
    <button className="button button-ghost crop-reset" type="button" onClick={() => onCropAspectChange(null)}>{t('resetCrop')}</button>
  </div>
}

function RotateSettings({ settings, onRotationChange, onSettingsChange }: { settings: ImageSettings; onRotationChange: (rotation: Rotation) => void; onSettingsChange: (patch: Partial<ImageSettings>) => void }) {
  const { t } = useI18n()
  const angles: Rotation[] = [0, 90, 180, 270]
  return <div className="settings-content">
    <p className="settings-intro">{t('rotateIntro')}</p>
    <span className="field-label">Rotation</span>
    <div className="preset-options rotation-options">{angles.map((angle) => <button className={settings.rotation === angle ? 'is-selected' : ''} key={angle} type="button" onClick={() => onRotationChange(angle)}>{angle}°</button>)}</div>
    <div className="setting-divider" />
    <span className="field-label">{t('flip')}</span>
    <div className="flip-options"><button className={`flip-button ${settings.flipX ? 'is-selected' : ''}`} type="button" onClick={() => onSettingsChange({ flipX: !settings.flipX })}><Icon name="compare" size={15} /> {t('horizontal')}</button><button className={`flip-button ${settings.flipY ? 'is-selected' : ''}`} type="button" onClick={() => onSettingsChange({ flipY: !settings.flipY })}><Icon name="compare" size={15} /> {t('vertical')}</button></div>
  </div>
}

function AdjustmentSlider({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="adjustment-control" htmlFor={id}><span>{label}</span><div><input id={id} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value > 0 ? `+${value}` : value}</strong></div></label>
}

function AdjustSettings({ adjustments, onAdjustmentChange }: { adjustments: Adjustments; onAdjustmentChange: (patch: Partial<Adjustments>) => void }) {
  const { t } = useI18n()
  return <div className="settings-content adjustments-content">
    <p className="settings-intro">{t('adjustIntro')}</p>
    <AdjustmentSlider id="brightness" label={t('brightness')} value={adjustments.brightness} min={-100} max={100} onChange={(value) => onAdjustmentChange({ brightness: value })} />
    <AdjustmentSlider id="contrast" label={t('contrast')} value={adjustments.contrast} min={-100} max={100} onChange={(value) => onAdjustmentChange({ contrast: value })} />
    <AdjustmentSlider id="saturation" label={t('saturation')} value={adjustments.saturation} min={-100} max={100} onChange={(value) => onAdjustmentChange({ saturation: value })} />
    <AdjustmentSlider id="exposure" label={t('exposure')} value={adjustments.exposure} min={-100} max={100} onChange={(value) => onAdjustmentChange({ exposure: value })} />
    <AdjustmentSlider id="blur" label={t('blur')} value={adjustments.blur} min={0} max={20} onChange={(value) => onAdjustmentChange({ blur: value })} />
    <AdjustmentSlider id="sharpen" label={t('sharpen')} value={adjustments.sharpen} min={0} max={100} onChange={(value) => onAdjustmentChange({ sharpen: value })} />
  </div>
}

function BackgroundSettings({ backgroundRemoval, isProcessing, mlProgress, mlStage, onBackgroundChange }: { backgroundRemoval: BackgroundRemoval; isProcessing: boolean; mlProgress: number; mlStage: string; onBackgroundChange: (patch: Partial<BackgroundRemoval>) => void }) {
  const { t } = useI18n()
  const isMl = backgroundRemoval.mode === 'ml'
  return <div className="settings-content">
    <p className="settings-intro">{t('backgroundIntro')}</p>
    <div className="ai-mode-options"><button className={isMl ? '' : 'is-selected'} type="button" aria-pressed={!isMl} onClick={() => onBackgroundChange({ mode: 'local', enabled: true })}>{t('fastCutout')}</button><button className={isMl ? 'is-selected' : ''} type="button" aria-pressed={isMl} onClick={() => onBackgroundChange({ mode: 'ml', enabled: true })}>{t('aiModel')}</button></div>
    <div className="local-ai-card"><span className="format-dot dot-lime" /><div><strong>{isMl ? 'WebGPU / WASM inference' : t('runsOnDevice')}</strong><small>{isMl ? `${ML_MODEL_SIZE_LABEL}. Cached after download.` : t('noModelDownload')}</small></div></div>
    <button className={`button ${backgroundRemoval.enabled ? 'button-secondary' : 'button-primary'} background-toggle`} type="button" disabled={isProcessing} onClick={() => onBackgroundChange({ enabled: !backgroundRemoval.enabled })}>{backgroundRemoval.enabled ? (isMl ? t('aiRemovalOn') : t('backgroundRemovalOn')) : (isMl ? t('runAi') : t('removeBackground'))} <Icon name={backgroundRemoval.enabled ? 'check' : 'wand'} size={15} /></button>
    {isMl && backgroundRemoval.enabled && <div className="ml-progress" aria-live="polite"><div className="batch-progress"><span style={{ width: `${Math.round(mlProgress * 100)}%` }} /></div><small>{isProcessing ? (mlStage || t('processingLocally')) : t('modelReady')}</small></div>}
    {!isMl && backgroundRemoval.enabled && <>
      <div className="setting-divider" />
      <AdjustmentSlider id="background-threshold" label="Color tolerance" value={backgroundRemoval.threshold} min={1} max={100} onChange={(value) => onBackgroundChange({ threshold: value })} />
      <AdjustmentSlider id="background-softness" label="Edge softness" value={backgroundRemoval.softness} min={0} max={40} onChange={(value) => onBackgroundChange({ softness: value })} />
    </>}
    <p className="settings-note">{t('aiLegalNote')}</p>
  </div>
}

function BatchQueue({ items, progress, isProcessing, error, onCancel }: { items: BatchItem[]; progress: number; isProcessing: boolean; error: string; onCancel: () => void }) {
  const { t } = useI18n()
  const statusLabel: Record<BatchStatus, string> = { queued: t('queued'), processing: t('processing'), success: t('ready'), failed: t('failed'), cancelled: t('cancelled') }
  return <div className="batch-queue">
    <div className="batch-heading"><div><span className="field-label">Batch queue</span><small>{items.length ? `${items.filter((item) => item.status === 'success').length} / ${items.length} ${t('ready').toLowerCase()}` : 'Multiple images selected'}</small></div>{isProcessing && <button className="batch-cancel" type="button" onClick={onCancel}>{t('cancel')}</button>}</div>
    {isProcessing && <div className="batch-progress"><span style={{ width: `${progress}%` }} /></div>}
    {items.length > 0 && <div className="batch-list" role="list">{items.map((item) => <div className="batch-item" key={item.id} role="listitem" title={item.error}><span className={`batch-status batch-status-${item.status}`}><Icon name={item.status === 'success' ? 'check' : item.status === 'failed' ? 'close' : item.status === 'processing' ? 'refresh' : 'file'} size={12} /></span><span className="batch-name">{item.name}</span><small>{statusLabel[item.status]}</small></div>)}</div>}
    {error && <p className="batch-error" role="alert">{error}</p>}
  </div>
}

function ToolPlaceholder({ tool }: { tool: Tool }) {
  return <div className="tool-placeholder"><div className="placeholder-icon"><Icon name={tool.icon} size={21} /></div><h3>{tool.label === 'Remove background' ? 'Coming in the next pass' : `${tool.label} controls`}</h3><p>{tool.label === 'Remove background' ? 'Local AI processing is on the roadmap. Your images will stay on-device.' : 'Select a setting to preview changes on your image.'}</p></div>
}

export default App
