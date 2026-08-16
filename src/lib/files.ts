export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const
export const MAX_FILE_SIZE = 25 * 1024 * 1024

export function isSupportedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function extensionForType(type: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
    'image/avif': 'AVIF',
  }
  return extensions[type] ?? 'IMAGE'
}

export function loadImage(file: File): Promise<{ url: string; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ url, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This image format is not supported by your browser.'))
    }
    image.src = url
  })
}
