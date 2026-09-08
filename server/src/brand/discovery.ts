import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type BrandTemplateEntry = { templateRef: string; path: string };

export async function collectBrandTemplates(
  templateRoot: string,
  directory: string,
  result: BrandTemplateEntry[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectBrandTemplates(templateRoot, path, result);
    else if (entry.isFile() && /^template\.(ya?ml|json)$/i.test(entry.name)) {
      const templateRef = relative(templateRoot, directory).replaceAll('\\', '/');
      if (templateRef) result.push({ templateRef, path });
    }
  }
}

export async function collectBrandProfiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !['assets', 'releases', 'templates'].includes(entry.name)) {
      names.push(...await collectBrandProfiles(join(directory, entry.name), relativeName));
    } else if (entry.isFile() && /\.(ya?ml|json)$/i.test(entry.name) && !['_brand', 'brand', 'showcase'].includes(entry.name.replace(/\.(ya?ml|json)$/i, ''))) {
      names.push(relativeName.replace(/\.(ya?ml|json)$/i, ''));
    }
  }
  return names;
}
