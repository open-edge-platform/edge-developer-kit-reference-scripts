export function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (!error || typeof error !== "object" || !("detail" in error)) return fallback

  const detail = error.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) =>
      item && typeof item === "object" && "msg" in item && typeof item.msg === "string"
        ? [item.msg]
        : [],
    )
    if (messages.length > 0) return messages.join("; ")
  }

  return fallback
}