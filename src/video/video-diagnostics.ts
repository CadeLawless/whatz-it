let diagnosticSequence = 0;

export function logRoundDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (!__DEV__) return;
  diagnosticSequence += 1;
  console.info(
    `[RoundDebug #${diagnosticSequence} ${new Date().toISOString()}] ${stage}`,
    details,
  );
}

export function warnRoundDiagnostic(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  if (!__DEV__) return;
  diagnosticSequence += 1;
  console.warn(`[RoundDebug #${diagnosticSequence} ${new Date().toISOString()}] ${stage}`, {
    ...details,
    error: error instanceof Error ? error.message : String(error),
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
