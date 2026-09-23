export type MetricName =
  | 'http_requests_total'
  | 'auth_failures_total'
  | 'rate_limits_total'
  | 'webhook_duplicates_total'
  | 'webhook_failures_total'
  | 'dependency_failures_total'
  | 'max_update_accepted_total'
  | 'max_update_duplicate_total'
  | 'max_update_failed_total'
  | 'max_api_requests_total'
  | 'max_api_429_total'
  | 'max_api_latency_ms'
  | 'module_capability_denied_total'
  | 'module_concurrency_denied_total'
  | 'module_timeout_total'
  | 'module_state_quota_rejected_total'
  | 'module_callback_denied_total'
  | 'readiness_failures_total'
  | 'graceful_shutdown_total'
  | 'uncaught_exception_total';

export type MetricLabels = Readonly<{
  status?: string;
  errorCode?: string;
  transport?: 'polling' | 'webhook';
  module?: string;
  operation?: string;
}>;

const labelValue = (value: string): string => /^[A-Za-z0-9_.:-]{1,32}$/u.test(value) ? value : 'other';
const metricKey = (name: MetricName, labels: MetricLabels): string => {
  const bounded = Object.entries(labels)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${labelValue(value)}`)
    .join(',');
  return bounded ? `${name}{${bounded}}` : name;
};

const prometheusKey = (key: string, suffix = ''): string => {
  const brace = key.indexOf('{');
  return brace < 0 ? `${key}${suffix}` : `${key.slice(0, brace)}${suffix}${key.slice(brace)}`;
};

export class PortalMetrics {
  private readonly startedAtMs = Date.now();
  private readonly counters = new Map<string, number>();
  private readonly observations = new Map<string, { count: number; sum: number }>();

  increment(name: MetricName, labels: MetricLabels = {}): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  observe(name: 'max_api_latency_ms', value: number, labels: MetricLabels = {}): void {
    if (!Number.isFinite(value) || value < 0 || value > 60_000) return;
    const key = metricKey(name, labels);
    const current = this.observations.get(key) ?? { count: 0, sum: 0 };
    current.count += 1;
    current.sum += value;
    this.observations.set(key, current);
  }

  snapshot(): Readonly<Record<string, number>> {
    const result: Record<string, number> = Object.fromEntries(this.counters.entries());
    for (const [key, observation] of this.observations) {
      result[`${key}_count`] = observation.count;
      result[`${key}_sum`] = observation.sum;
    }
    return result;
  }

  prometheus(): string {
    const formatLabels = (key: string): string => key.replace(/\{([^}]*)\}/u, (_, labels: string) => `{${labels.split(',').map((part) => part.replace('=', '="') + '"').join(',')}}`);
    const counterLines = [...this.counters.entries()].map(([key, value]) => `${formatLabels(key)} ${value}`);
    const observationLines = [...this.observations.entries()].flatMap(([key, observation]) => [
      `${formatLabels(prometheusKey(key, '_count'))} ${observation.count}`,
      `${formatLabels(prometheusKey(key, '_sum'))} ${observation.sum}`,
    ]);
    const processLines = [
      `portal_process_start_time_seconds ${Math.floor(this.startedAtMs / 1000)}`,
      `portal_process_uptime_seconds ${Math.max(0, (Date.now() - this.startedAtMs) / 1000)}`,
      `portal_process_resident_memory_bytes ${process.memoryUsage().rss}`,
    ];
    return [...counterLines, ...observationLines, ...processLines].join('\n');
  }
}
