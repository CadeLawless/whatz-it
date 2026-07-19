import { flushFlightRecorder, recordFlightEvent } from '@/utils/flight-recorder';

const ROUND_DIAGNOSTICS_ENABLED = true;

export function logRoundDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (!ROUND_DIAGNOSTICS_ENABLED) return;
  recordFlightEvent(stage, details);
  console.info(`[RoundDiagnostic] ${stage}`, {
    at: new Date().toISOString(),
    ...details,
  });
}

export function warnRoundDiagnostic(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  if (!ROUND_DIAGNOSTICS_ENABLED) return;
  recordFlightEvent(stage, { error: describeDiagnosticError(error), ...details }, { level: 'warn' });
  console.warn(`[RoundDiagnostic] ${stage}`, {
    at: new Date().toISOString(),
    error: describeDiagnosticError(error),
    ...details,
  });
}

export function logVideoDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  logRoundDiagnostic(`video: ${stage}`, details);
}

export function warnVideoDiagnostic(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  warnRoundDiagnostic(`video: ${stage}`, error, details);
}

export function flushRoundDiagnostics() {
  flushFlightRecorder();
}

function describeDiagnosticError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return error;
}
