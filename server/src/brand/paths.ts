import { resolve } from 'node:path';

export function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function safeRelativePath(rootDir: string, requested: string, subject = 'Brand path'): string {
  const candidate = resolve(rootDir, requested);
  const root = resolve(rootDir);
  if (!isInside(root, candidate)) throw new Error(`${subject} escapes configured root: ${requested}`);
  return candidate;
}
