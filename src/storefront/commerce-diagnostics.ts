import { flushFlightRecorder, recordFlightEvent } from '@/utils/flight-recorder';

type CommerceDiagnosticLevel = 'info' | 'warn';

export function logCommerceDiagnostic(
  stage: string,
  details: Record<string, unknown> = {},
  level: CommerceDiagnosticLevel = 'info',
) {
  const fullStage = `commerce.${stage}`;
  recordFlightEvent(fullStage, details, { level });
  flushFlightRecorder();

  if (__DEV__) {
    const method = level === 'warn' ? console.warn : console.info;
    method(`[StoreCommerce] ${stage}`, {
      at: new Date().toISOString(),
      ...details,
    });
  }
}

export function describeCommerceError(error: unknown) {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: unknown;
      debugMessage?: unknown;
      productId?: unknown;
      responseCode?: unknown;
      status?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      ...(typeof candidate.debugMessage === 'string'
        ? { debugMessage: candidate.debugMessage }
        : {}),
      ...(typeof candidate.productId === 'string'
        ? { productId: candidate.productId }
        : {}),
      ...(typeof candidate.responseCode === 'number'
        ? { responseCode: candidate.responseCode }
        : {}),
      ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
    };
  }
  return { value: String(error) };
}
