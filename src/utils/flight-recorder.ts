import { File, Paths } from 'expo-file-system';
import { AppState, type AppStateStatus, Platform } from 'react-native';

const FLIGHT_RECORDER_FILE_NAME = 'whatz-it-flight-recorder.json';
const FLUSH_DELAY_MS = 250;
const MAX_CURRENT_ENTRIES = 140;
const MAX_UNEXPECTED_EXIT_ENTRIES = 100;
const MAX_ARRAY_ITEMS = 16;
const MAX_OBJECT_KEYS = 24;
const MAX_STRING_LENGTH = 500;
const MAX_VALUE_DEPTH = 4;

type FlightRecorderLevel = 'info' | 'warn';

export type FlightRecorderEntry = {
  at: string;
  details?: Record<string, unknown>;
  level: FlightRecorderLevel;
  sessionId: string;
  stage: string;
};

type FlightRecorderSession = {
  appState: AppStateStatus;
  expectedExit: boolean;
  id: string;
  lastEventAt: string;
  route?: string;
  startedAt: string;
};

export type UnexpectedExitSnapshot = {
  detectedAt: string;
  entries: FlightRecorderEntry[];
  session: FlightRecorderSession;
};

type FlightRecorderState = {
  entries: FlightRecorderEntry[];
  lastUnexpectedExit?: UnexpectedExitSnapshot;
  session: FlightRecorderSession;
  version: 1;
};

type RecordFlightEventOptions = {
  flush?: boolean;
  level?: FlightRecorderLevel;
};

let initialized = false;
let recorderFile: File | null = null;
let recorderState: FlightRecorderState | null = null;
let scheduledFlush: ReturnType<typeof setTimeout> | null = null;
let newlyDetectedUnexpectedExit: UnexpectedExitSnapshot | null = null;

export function initializeFlightRecorder() {
  ensureInitialized();
  if (recorderState?.session.expectedExit) {
    recorderState.session.expectedExit = false;
    recordFlightEvent('session.root-remounted', {}, { flush: true });
  }
  return newlyDetectedUnexpectedExit;
}

export function recordFlightEvent(
  stage: string,
  details: Record<string, unknown> = {},
  options: RecordFlightEventOptions = {},
) {
  ensureInitialized();
  if (!recorderState) return;

  const at = new Date().toISOString();
  recorderState.entries.push({
    at,
    details: sanitizeDetails(details),
    level: options.level ?? 'info',
    sessionId: recorderState.session.id,
    stage,
  });
  recorderState.entries = recorderState.entries.slice(-MAX_CURRENT_ENTRIES);
  recorderState.session.lastEventAt = at;

  if (options.flush) flushFlightRecorder();
  else scheduleFlush();
}

export function setFlightRecorderAppState(appState: AppStateStatus) {
  ensureInitialized();
  if (!recorderState) return;
  const previousState = recorderState.session.appState;
  recorderState.session.appState = appState;
  recordFlightEvent('lifecycle.app-state-changed', { appState, previousState }, { flush: true });
}

export function setFlightRecorderRoute(route: string) {
  ensureInitialized();
  if (!recorderState || recorderState.session.route === route) return;
  const previousRoute = recorderState.session.route;
  recorderState.session.route = route;
  recordFlightEvent('navigation.route-changed', { previousRoute, route }, { flush: true });
}

export function recordFlightRecorderMemoryWarning() {
  recordFlightEvent(
    'lifecycle.memory-warning',
    {
      appState: recorderState?.session.appState ?? AppState.currentState,
      route: recorderState?.session.route,
    },
    { flush: true, level: 'warn' },
  );
}

export function markFlightRecorderExpectedExit(reason: string) {
  ensureInitialized();
  if (!recorderState) return;
  recorderState.session.expectedExit = true;
  recordFlightEvent('session.expected-exit', { reason }, { flush: true });
}

export function flushFlightRecorder() {
  ensureInitialized();
  if (scheduledFlush !== null) {
    clearTimeout(scheduledFlush);
    scheduledFlush = null;
  }
  persistState();
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  const now = new Date().toISOString();
  const storedState = readStoredState();
  if (
    storedState &&
    !storedState.session.expectedExit &&
    storedState.session.appState === 'active'
  ) {
    newlyDetectedUnexpectedExit = {
      detectedAt: now,
      entries: storedState.entries.slice(-MAX_UNEXPECTED_EXIT_ENTRIES),
      session: storedState.session,
    };
  }

  const sessionId = createSessionId();
  recorderState = {
    entries: [
      {
        at: now,
        details: {
          appState: AppState.currentState,
          developmentBuild: __DEV__,
          platform: Platform.OS,
        },
        level: 'info',
        sessionId,
        stage: 'session.started',
      },
    ],
    lastUnexpectedExit: newlyDetectedUnexpectedExit ?? storedState?.lastUnexpectedExit,
    session: {
      appState: AppState.currentState,
      expectedExit: false,
      id: sessionId,
      lastEventAt: now,
      startedAt: now,
    },
    version: 1,
  };
  persistState();

  if (newlyDetectedUnexpectedExit) {
    console.warn('[FlightRecorder] Previous session ended unexpectedly while active.', {
      detectedAt: newlyDetectedUnexpectedExit.detectedAt,
      lastEntries: newlyDetectedUnexpectedExit.entries.slice(-30),
      session: newlyDetectedUnexpectedExit.session,
    });
  }
}

function readStoredState() {
  if (Platform.OS === 'web') return null;
  try {
    const file = getRecorderFile();
    if (!file.exists) return null;
    const candidate = JSON.parse(file.textSync()) as Partial<FlightRecorderState>;
    if (
      candidate.version !== 1 ||
      !candidate.session ||
      !Array.isArray(candidate.entries)
    ) {
      return null;
    }
    return candidate as FlightRecorderState;
  } catch (error) {
    console.warn('[FlightRecorder] Could not read the previous diagnostic snapshot.', error);
    return null;
  }
}

function persistState() {
  if (Platform.OS === 'web' || !recorderState) return;
  try {
    const file = getRecorderFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(recorderState));
  } catch (error) {
    console.warn('[FlightRecorder] Could not persist the diagnostic snapshot.', error);
  }
}

function scheduleFlush() {
  if (scheduledFlush !== null || Platform.OS === 'web') return;
  scheduledFlush = setTimeout(() => {
    scheduledFlush = null;
    persistState();
  }, FLUSH_DELAY_MS);
}

function getRecorderFile() {
  recorderFile ??= new File(Paths.document, FLIGHT_RECORDER_FILE_NAME);
  return recorderFile;
}

function sanitizeDetails(details: Record<string, unknown>) {
  return sanitizeValue(details, 0, new WeakSet<object>()) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) {
    return {
      message: sanitizeValue(value.message, depth + 1, seen),
      name: value.name,
      stack: sanitizeValue(value.stack, depth + 1, seen),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_VALUE_DEPTH) return '[max-depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) sanitized.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    return sanitized;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, item] of entries) {
    try {
      result[key] = sanitizeValue(item, depth + 1, seen);
    } catch {
      result[key] = '[unavailable]';
    }
  }
  const omittedKeyCount = Object.keys(value).length - entries.length;
  if (omittedKeyCount > 0) result.__omittedKeys = omittedKeyCount;
  return result;
}

function createSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
