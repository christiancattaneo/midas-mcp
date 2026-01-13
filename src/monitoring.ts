/**
 * Production Monitoring Integration
 * 
 * Provides hooks for:
 * - Error tracking (Sentry)
 * - Observability (OpenTelemetry)
 * - Custom metrics
 * 
 * These are optional integrations - if the libraries aren't installed,
 * the hooks gracefully degrade to no-ops.
 */

import { logger } from './logger.js';

// ============================================================================
// TYPES
// ============================================================================

interface ErrorContext {
  phase?: string;
  step?: string;
  tool?: string;
  projectPath?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

interface MetricTags {
  provider?: string;
  phase?: string;
  cached?: boolean;
  [key: string]: string | boolean | number | undefined;
}

// ============================================================================
// SENTRY INTEGRATION
// ============================================================================

let sentryClient: unknown | null = null;
let sentryInitialized = false;

/**
 * Initialize Sentry if SENTRY_DSN is set
 * 
 * Sentry cost estimate (free tier):
 * - 5,000 errors/month free
 * - 10,000 performance samples/month free
 * - Beyond free: ~$0.000029 per error
 * 
 * MAX MONTHLY COST: ~$15 at 500k errors (extreme case)
 * Expected: $0 (well under free tier for dev tools)
 */
export function initSentry(): boolean {
  if (sentryInitialized) return !!sentryClient;
  sentryInitialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.debug('Sentry not configured (no SENTRY_DSN)');
    return false;
  }

  try {
    // Dynamic import to avoid requiring Sentry as a dependency
    // Users can install @sentry/node if they want this feature
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    import('@sentry/node' as string).then((Sentry: unknown) => {
      const S = Sentry as { 
        init: (opts: Record<string, unknown>) => void;
        withScope: (fn: (scope: unknown) => void) => void;
        captureException: (err: Error) => void;
        addBreadcrumb: (crumb: Record<string, unknown>) => void;
      };
      S.init({
        dsn,
        environment: process.env.NODE_ENV || 'development',
        release: process.env.npm_package_version,
        tracesSampleRate: 0.1,
        enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_ENABLED === 'true',
        maxBreadcrumbs: 50,
      });
      sentryClient = Sentry;
      logger.info('Sentry initialized');
    }).catch(() => {
      logger.debug('Sentry package not installed');
    });
    return true;
  } catch {
    logger.debug('Sentry initialization failed');
    return false;
  }
}

/**
 * Capture an error with context
 */
export function captureError(error: Error, context?: ErrorContext): void {
  logger.error('Error captured', { error: error.message, ...context });

  if (!sentryClient) return;

  try {
    const S = sentryClient as { 
      withScope: (fn: (scope: { setTag: (k: string, v: string) => void; setContext: (k: string, v: unknown) => void; setExtras: (e: Record<string, unknown>) => void }) => void) => void;
      captureException: (err: Error) => void;
    };
    S.withScope((scope) => {
      if (context?.phase) scope.setTag('phase', context.phase);
      if (context?.step) scope.setTag('step', context.step);
      if (context?.tool) scope.setTag('tool', context.tool);
      if (context?.projectPath) scope.setContext('project', { path: context.projectPath });
      if (context?.extra) scope.setExtras(context.extra);
      S.captureException(error);
    });
  } catch {
    // Silently fail - monitoring should never break the app
  }
}

/**
 * Add a breadcrumb for debugging context
 */
export function addBreadcrumb(message: string, category: string, data?: Record<string, unknown>): void {
  if (!sentryClient) return;

  try {
    const S = sentryClient as { 
      addBreadcrumb: (crumb: Record<string, unknown>) => void;
    };
    S.addBreadcrumb({
      message,
      category,
      data,
      level: 'info',
    });
  } catch {
    // Silently fail
  }
}

// ============================================================================
// OPENTELEMETRY INTEGRATION
// ============================================================================

let otelMeter: unknown | null = null;
let otelInitialized = false;

// Metric counters (created lazily)
let analysisCounter: unknown | null = null;
let tokenCounter: unknown | null = null;
let latencyHistogram: unknown | null = null;

/**
 * Initialize OpenTelemetry metrics if OTEL_EXPORTER_OTLP_ENDPOINT is set
 * 
 * OpenTelemetry is free (self-hosted) or pay-per-use with vendors:
 * - Datadog: ~$0.10 per million custom metrics
 * - Grafana Cloud: 10k series free, then ~$8/1k series
 * - Self-hosted: Infrastructure costs only
 * 
 * MAX MONTHLY COST: ~$10 at typical usage
 */
export function initOpenTelemetry(): boolean {
  if (otelInitialized) return !!otelMeter;
  otelInitialized = true;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    logger.debug('OpenTelemetry not configured (no OTEL_EXPORTER_OTLP_ENDPOINT)');
    return false;
  }

  try {
    // Dynamic import to avoid requiring OTel as a dependency
    import('@opentelemetry/api' as string).then((api: unknown) => {
      const otelApi = api as {
        metrics: {
          getMeter: (name: string) => {
            createCounter: (name: string, opts: Record<string, string>) => unknown;
            createHistogram: (name: string, opts: Record<string, string>) => unknown;
          };
        };
      };
      otelMeter = otelApi.metrics.getMeter('midas-mcp');
      
      // Create counters
      const meter = otelMeter as {
        createCounter: (name: string, opts: Record<string, string>) => unknown;
        createHistogram: (name: string, opts: Record<string, string>) => unknown;
      };
      analysisCounter = meter.createCounter('midas.analysis.count', {
        description: 'Number of project analyses',
      });
      tokenCounter = meter.createCounter('midas.tokens.total', {
        description: 'Total tokens consumed',
      });
      latencyHistogram = meter.createHistogram('midas.analysis.latency', {
        description: 'Analysis latency in milliseconds',
        unit: 'ms',
      });
      
      logger.info('OpenTelemetry metrics initialized');
    }).catch(() => {
      logger.debug('OpenTelemetry package not installed');
    });
    return true;
  } catch {
    logger.debug('OpenTelemetry initialization failed');
    return false;
  }
}

/**
 * Record an analysis event
 */
export function recordAnalysis(latencyMs: number, tags?: MetricTags): void {
  if (!otelMeter || !analysisCounter || !latencyHistogram) return;

  try {
    const counter = analysisCounter as { add: (val: number, attrs: Record<string, string>) => void };
    const histogram = latencyHistogram as { record: (val: number, attrs: Record<string, string>) => void };
    
    const attributes = {
      provider: tags?.provider || 'unknown',
      phase: tags?.phase || 'unknown',
      cached: String(tags?.cached ?? false),
    };
    
    counter.add(1, attributes);
    histogram.record(latencyMs, attributes);
  } catch {
    // Silently fail
  }
}

/**
 * Record token usage
 */
export function recordTokens(inputTokens: number, outputTokens: number, tags?: MetricTags): void {
  if (!otelMeter || !tokenCounter) return;

  try {
    const counter = tokenCounter as { add: (val: number, attrs: Record<string, string>) => void };
    
    const attributes = {
      provider: tags?.provider || 'unknown',
      type: 'input',
    };
    
    counter.add(inputTokens, attributes);
    counter.add(outputTokens, { ...attributes, type: 'output' });
  } catch {
    // Silently fail
  }
}

// ============================================================================
// UNIFIED MONITORING INTERFACE
// ============================================================================

/**
 * Initialize all monitoring integrations
 * Call this once at startup
 */
export function initMonitoring(): { sentry: boolean; otel: boolean } {
  const sentry = initSentry();
  const otel = initOpenTelemetry();
  
  if (sentry || otel) {
    logger.info('Monitoring initialized', { sentry, otel });
  }
  
  return { sentry, otel };
}

/**
 * Wrap an async function with error tracking
 */
export function withErrorTracking<T>(
  fn: () => Promise<T>,
  context?: ErrorContext
): Promise<T> {
  return fn().catch((error) => {
    captureError(error as Error, context);
    throw error;
  });
}

/**
 * Create a timed operation for metrics
 */
export function startTimer(): { end: (tags?: MetricTags) => number } {
  const start = Date.now();
  return {
    end(tags?: MetricTags): number {
      const latency = Date.now() - start;
      recordAnalysis(latency, tags);
      return latency;
    },
  };
}

/**
 * Health check for monitoring systems
 */
export function getMonitoringHealth(): {
  sentry: { initialized: boolean; configured: boolean };
  otel: { initialized: boolean; configured: boolean };
} {
  return {
    sentry: {
      initialized: sentryInitialized,
      configured: !!sentryClient,
    },
    otel: {
      initialized: otelInitialized,
      configured: !!otelMeter,
    },
  };
}
