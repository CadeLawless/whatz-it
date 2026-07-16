export function logRoundDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  // Detailed round diagnostics are intentionally disabled for now.
  void stage;
  void details;
}

export function warnRoundDiagnostic(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {},
) {
  // Detailed round diagnostics are intentionally disabled for now.
  void stage;
  void error;
  void details;
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
