#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'examples/brand-showcase/generated/showcase');
const failures = [];
const manifests = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name === 'manifest.json') manifests.push(path);
  }
}

function fail(path, message) {
  failures.push(`${path}: ${message}`);
}

function outputPath(manifestPath, value) {
  return typeof value === 'string' && !value.startsWith('/') ? join(dirname(manifestPath), value) : value;
}

function hex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : null;
}

function luminance(value) {
  const raw = hex(value);
  if (!raw) return null;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const fg = luminance(foreground);
  const bg = luminance(background);
  if (fg === null || bg === null) return null;
  const light = Math.max(fg, bg);
  const dark = Math.min(fg, bg);
  return (light + 0.05) / (dark + 0.05);
}

async function assertFile(path, kind) {
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return fail(path, 'declared output is missing');
  if (kind === 'png') {
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(path, 'not a PNG');
    if (bytes.readUInt32BE(16) !== 1600 || bytes.readUInt32BE(20) !== 900) fail(path, `expected 1600x900 PNG, got ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
  }
  if (kind === 'pdf' && bytes.subarray(0, 4).toString() !== '%PDF') fail(path, 'not a PDF');
  if (kind === 'pptx' && bytes.subarray(0, 2).toString() !== 'PK') fail(path, 'not a PPTX zip');
}

function auditTheme(path, theme, label) {
  if (!theme) return fail(path, `${label} has no resolved theme summary`);
  for (const key of ['background', 'foreground', 'primary', 'secondary', 'muted', 'line', 'surface', 'success', 'danger', 'warning', 'imageTextColor']) {
    if (!hex(theme[key])) fail(path, `${label}.${key} is not a six-digit hex colour: ${theme[key]}`);
  }
  const ratio = contrast(theme.foreground, theme.background);
  if (ratio !== null && ratio < 4.5) fail(path, `${label} foreground/background contrast is only ${ratio.toFixed(2)}:1`);
  for (const [role, color] of [['muted', theme.muted], ['success', theme.success], ['danger', theme.danger], ['warning', theme.warning]]) {
    for (const [backgroundName, background] of [['background', theme.background], ['surface', theme.surface]]) {
      const roleRatio = contrast(color, background);
      if (roleRatio !== null && roleRatio < 3) fail(path, `${label} ${role}/${backgroundName} contrast is only ${roleRatio.toFixed(2)}:1`);
    }
  }
  if (theme.headerStyle === 'accent-band') {
    const bandRatio = contrast('#ffffff', theme.primary);
    if (bandRatio !== null && bandRatio < 4.5) fail(path, `${label} white text on accent band contrast is only ${bandRatio.toFixed(2)}:1`);
  }
  if (theme.headerStyle === 'dark-band') {
    const bandRatio = contrast('#ffffff', theme.background);
    if (bandRatio !== null && bandRatio < 4.5) fail(path, `${label} white text on dark band contrast is only ${bandRatio.toFixed(2)}:1`);
  }
  if (theme.hasBackgroundImage) {
    const imageProxy = contrast(theme.imageTextColor, theme.background);
    if (imageProxy !== null && imageProxy < 4.5) fail(path, `${label} image text proxy contrast is only ${imageProxy.toFixed(2)}:1`);
  }
}

await walk(root);
if (manifests.length === 0) fail(root, 'no showcase manifests found; render with --kind showcase first');

const fontFamilies = new Set();
for (const path of manifests) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schema_version !== 1) fail(path, `unsupported manifest schema_version: ${manifest.schema_version}`);
  if (manifest.kind !== 'showcase') fail(path, `expected kind showcase, got ${manifest.kind}`);
  const reports = manifest.outputs?.reports ?? [];
  const decks = manifest.outputs?.decks ?? [];
  const complexity = manifest.showcase?.complexity ?? 'custom';
  const expected = complexity === 'basic' ? { reports: 1, profiles: 1, signatures: 1 } : complexity === 'rich' ? { reports: 2, profiles: 5, signatures: 5 } : { reports: 2, profiles: 4, signatures: 4 };
  if (reports.length < expected.reports) fail(path, `${complexity} showcase must include at least ${expected.reports} report case(s)`);
  if (decks.length < 1) fail(path, 'showcase must include a deck');
  for (const report of reports) {
    auditTheme(path, report.theme, `report ${report.id}`);
    fontFamilies.add(report.theme?.fontFamily);
    await assertFile(outputPath(path, report.outputs?.pdf), 'pdf');
  }
  for (const deck of decks) {
    const profiles = new Set((deck.slideDiagnostics ?? []).map((item) => item.profile));
    if (profiles.size < expected.profiles) fail(path, `${complexity} deck ${deck.id} exposes only ${profiles.size} surface profiles; expected at least ${expected.profiles}`);
    const signatures = new Set((deck.slideThemes ?? []).map((theme) => `${theme.background}|${theme.foreground}|${theme.headerStyle}|${theme.fontFamily}`));
    if (signatures.size < expected.signatures) fail(path, `${complexity} deck ${deck.id} has only ${signatures.size} visual signatures; expected at least ${expected.signatures}`);
    auditTheme(path, deck.theme, `deck ${deck.id} base`);
    fontFamilies.add(deck.theme?.fontFamily);
    for (const [index, theme] of (deck.slideThemes ?? []).entries()) auditTheme(path, theme, `deck ${deck.id} slide ${index + 1}`);
    await assertFile(outputPath(path, deck.outputs?.pdf), 'pdf');
    await assertFile(outputPath(path, deck.outputs?.pptx), 'pptx');
    const pngs = deck.outputs?.png ?? [];
    if (pngs.length !== (deck.slideThemes ?? []).length) fail(path, `deck ${deck.id} has ${pngs.length} PNGs for ${(deck.slideThemes ?? []).length} slides`);
    for (const png of pngs) await assertFile(outputPath(path, png), 'png');
  }
}
if (manifests.length >= 4 && fontFamilies.size < 4) fail(root, `expected at least 4 distinct showcase fonts, got ${[...fontFamilies].join(', ')}`);

if (failures.length > 0) {
  console.error(`Brand showcase audit failed (${failures.length} issue(s))`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Brand showcase audit passed: ${manifests.length} manifest(s), ${fontFamilies.size} distinct font families, contrast/layout/output checks OK.`);
}
