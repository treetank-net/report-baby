import { pathToFileURL } from 'node:url';
import { runProcess } from './process.mjs';

export function findOfficeConverter(profileDirectory, { filesystemDirectory = profileDirectory, filesystemDirectories = [] } = {}) {
  const profile = `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`;
  for (const command of ['soffice', 'libreoffice']) {
    const path = runProcess('which', [command]);
    if (path.status !== 0 || !path.stdout.trim()) continue;
    const version = runProcess(command, ['--version']);
    return {
      label: command,
      command,
      prefixArgs: [profile],
      version: version.stdout.trim() || version.stderr.trim() || 'unknown',
      filesystemArgs: [],
    };
  }
  const info = runProcess('flatpak', ['info', 'org.libreoffice.LibreOffice']);
  if (info.status !== 0) return null;
  const version = /^\s*Version:\s*(.+)$/m.exec(info.stdout)?.[1]?.trim() ?? 'unknown';
  const directories = [...new Set([filesystemDirectory, ...filesystemDirectories])];
  return {
    label: 'flatpak:org.libreoffice.LibreOffice',
    command: 'flatpak',
    prefixArgs: ['run', ...directories.map((directory) => `--filesystem=${directory}`), '--env=SAL_USE_VCLPLUGIN=svp', 'org.libreoffice.LibreOffice', profile],
    version,
    filesystemArgs: directories.map((directory) => `--filesystem=${directory}`),
  };
}
