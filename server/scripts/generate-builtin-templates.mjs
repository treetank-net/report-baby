import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = join(serverRoot, 'templates');
const outputPath = join(serverRoot, 'src', 'generated', 'builtin-templates.ts');

async function collectYamlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectYamlFiles(absolute));
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

const files = await collectYamlFiles(templateRoot);
if (files.length === 0) throw new Error(`No built-in template YAML files were found in ${templateRoot}.`);

const entries = await Promise.all(files.map(async (file) => {
  const key = relative(templateRoot, file).replaceAll('\\', '/');
  return `  ${JSON.stringify(key)}: ${JSON.stringify(await readFile(file, 'utf8'))},`;
}));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `export const BUILTIN_TEMPLATE_FILES: Record<string, string> = {\n${entries.join('\n')}\n};\n`);
console.log(`Embedded ${files.length} built-in template files into ${relative(serverRoot, outputPath)}`);
