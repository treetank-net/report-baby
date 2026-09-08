export interface RecordValue {
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

export function merge(base: RecordValue, overlay: RecordValue): RecordValue {
  const output = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (isRecord(output[key]) && isRecord(value)) output[key] = merge(output[key] as RecordValue, value);
    else output[key] = clone(value);
  }
  return output;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function selectVariant(value: unknown, surface?: string): unknown {
  if (!isRecord(value)) return value;
  const isDark = Boolean(surface?.toLowerCase().includes('dark'));
  return value[isDark ? 'dark' : 'light'] ?? value.default ?? value;
}

export function stringFromTypography(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  return asString(value.family);
}
