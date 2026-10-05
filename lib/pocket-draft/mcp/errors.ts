export class PocketDraftMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
    readonly commandIndex?: number
  ) {
    super(message)
    this.name = "PocketDraftMcpError"
  }

  candidates?: Array<{ id: string; name: string; kind: string }>
  objectId?: string
  hint?: string
}

export function isPocketDraftMcpError(
  error: unknown
): error is PocketDraftMcpError {
  return error instanceof PocketDraftMcpError
}
