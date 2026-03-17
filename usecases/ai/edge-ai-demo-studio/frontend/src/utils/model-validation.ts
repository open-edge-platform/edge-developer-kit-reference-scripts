export const validateOpenVINOModelName = (name: string): boolean => {
  if (!name || name.trim() === '') return false

  // Common validation for invalid characters
  if (name.includes('\\') || name.includes('..')) {
    return false
  }

  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return false
  }

  return true
}

export const validateIsOpenVINOModelName = (name: string): boolean => {
  if (!name || name.trim() === '') return false

  // Common validation for invalid characters
  if (name.includes('\\') || name.includes('..')) {
    return false
  }

  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return false
  }

  const [, modelNamePart] = parts
  const validSuffixes = ['-ov', '-ovz']
  return validSuffixes.some((suffix) =>
    modelNamePart.split(':')[0].endsWith(suffix),
  )
}

export const validateLlamaCPPModelName = (name: string): boolean => {
  if (!name || name.trim() === '') return false

  // Common validation for invalid characters
  if (name.includes('\\') || name.includes('..')) {
    return false
  }

  const parts = name.split('/')
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return false
  }

  const [, modelNamePart] = parts
  const validSuffixes = ['-GGUF']
  return validSuffixes.some((suffix) =>
    modelNamePart.split(':')[0].endsWith(suffix),
  )
}
