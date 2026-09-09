import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { zipSync } from 'fflate';
import { parse } from 'yaml';
import { childProcessFailure } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-report-images-'));
const contentRoot = join(temporary, 'content');
const output = join(temporary, 'report.pdf');
const execFileAsync = promisify(execFile);
const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
const reportImageQa = renderConfig.quality;

function runCli(input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: temporary, REPORT_BABY_BRAND_DIR: join(temporary, 'brands') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(childProcessFailure('report-image CLI', { status: code, signal, stdout, stderr }))));
    const request = { ...input, data: legacyFixtureToCompositionInput(input.data) };
    child.stdin.end(JSON.stringify([{ tool: 'render_report', args: request }]));
  });
}

async function pdfWords(path) {
  const result = await execFileAsync('pdftotext', ['-bbox-layout', path, '-']);
  const words = [];
  let page = 0;
  for (const pageMatch of result.stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu)) {
    for (const wordMatch of pageMatch[1].matchAll(/<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gu)) {
      words.push({ page, xMin: Number(wordMatch[1]), yMin: Number(wordMatch[2]), xMax: Number(wordMatch[3]), yMax: Number(wordMatch[4]), text: wordMatch[5].replace(/<[^>]+>/gu, '') });
    }
    page += 1;
  }
  return words;
}

function normalizedPdfToken(value) {
  return value.toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, '');
}

try {
  await cp(join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'), join(contentRoot, 'assets/map.png'), { recursive: true });
  await execFileAsync('ffmpeg', ['-v', 'error', '-i', join(contentRoot, 'assets/map.png'), '-frames:v', '1', join(contentRoot, 'assets/map.webp')]);
  await execFileAsync('ffmpeg', ['-v', 'error', '-i', join(contentRoot, 'assets/map.png'), '-frames:v', '1', join(contentRoot, 'assets/map.avif')]);
  await writeFile(join(contentRoot, 'assets/float.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#d76b4c"/></svg>');
  const result = await runCli({
    content_root: contentRoot,
    output_path: output,
    diagnostics: 'full',
    data: {
      title: 'Image report',
      sections: [{ heading: 'Map', body: 'A short introduction.\n\n![Map of the fleet](assets/map.png "Fleet map")' }],
    },
  });
  const structured = JSON.parse(result.stdout.trim().split('\n')[0]);
  assert.equal(structured.path, output);
  assert.ok((await readFile(output)).length > 0);
  assert.equal(structured.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.equal(structured.warnings, undefined);
  for (const extension of ['webp', 'avif']) {
    const encodedOutput = join(temporary, `encoded-${extension}.pdf`);
    const encodedResult = await runCli({
      template: 'pages/editorial-two-column',
      content_root: contentRoot,
      output_path: encodedOutput,
      diagnostics: 'full',
      data: {
        title: `${extension.toUpperCase()} image report`,
        sections: [{ heading: 'Encoded image', content: [{ type: 'image', src: `assets/map.${extension}`, alt: `${extension} map`, width: '80%', fit: 'contain' }] }],
      },
    });
    const encoded = JSON.parse(encodedResult.stdout.trim().split('\n')[0]);
    assert.equal(encoded.drawings.filter((drawing) => drawing.kind === 'image').length, 1, `${extension} image must render through the composition backend`);
    assert.equal(encoded.warnings, undefined, `${extension} image should not produce a fallback warning`);
  }
  const introOutput = join(temporary, 'intro-image-report.pdf');
  const introResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: introOutput,
    diagnostics: 'full',
    data: {
      title: 'Intro image report',
      intro: '![Intro image](root://assets/map.png "Intro caption")\n\nThe lead remains selectable text below the image.',
      sections: [{ heading: 'Editorial body', body: 'The editorial body follows the Markdown-enabled intro block.' }],
    },
  });
  const introContent = JSON.parse(introResult.stdout.trim().split('\n')[0]);
  const introImage = introContent.drawings.find((drawing) => drawing.kind === 'image');
  const introCaption = introContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text === 'Intro caption');
  const introLead = introContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text.includes('lead remains selectable'));
  const introImagePlacement = introContent.compositionPlan?.blockPlacements?.find((placement) => placement.kind === 'image');
  assert.equal(introContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.ok(introImage && introImage.y < 110, JSON.stringify(introContent.drawings));
  assert.ok(introImage && introImagePlacement?.imageBox && Math.abs(introImage.y - introImagePlacement.imageBox.y) < 0.01, JSON.stringify({ introImage, introImagePlacement }));
  assert.ok(introCaption && introCaption.x > introImage.x, JSON.stringify(introContent.drawings));
  assert.ok(introCaption && introCaption.y > introImage.y + introImage.height, JSON.stringify(introContent.drawings));
  const introCaptionBox = introImagePlacement?.captionBox;
  assert.ok(introCaptionBox, JSON.stringify({ introImagePlacement }));
  const pointPerMm = 72 / 25.4;
  const captionWords = (await pdfWords(introOutput)).filter((word) => {
    if (!['intro', 'caption'].includes(normalizedPdfToken(word.text))) return false;
    const xMin = word.xMin / pointPerMm;
    const yMin = word.yMin / pointPerMm;
    const xMax = word.xMax / pointPerMm;
    const yMax = word.yMax / pointPerMm;
    return xMin >= introCaptionBox.x && xMax <= introCaptionBox.x + introCaptionBox.width && yMin >= introCaptionBox.y && yMax <= introCaptionBox.y + introCaptionBox.height;
  });
  assert.equal(captionWords.length, 2, JSON.stringify({ captionWords, introImagePlacement }));
  const captionInkTop = Math.min(...captionWords.map((word) => word.yMin / pointPerMm));
  const captionInkBottom = Math.max(...captionWords.map((word) => word.yMax / pointPerMm));
  const captionTopGap = captionInkTop - introCaptionBox.y;
  const captionBottomGap = introCaptionBox.y + introCaptionBox.height - captionInkBottom;
  assert.ok(Math.abs(captionTopGap - captionBottomGap) <= reportImageQa.pdf_pixel_qa.caption_vertical_balance_tolerance_mm, JSON.stringify({ captionTopGap, captionBottomGap, introCaptionBox, captionWords }));
  const controlOutput = join(temporary, 'intro-control-report.pdf');
  const controlResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: controlOutput,
    diagnostics: 'full',
    data: {
      title: 'Intro control report',
      intro: 'The lead remains selectable text below the image.',
      sections: [{ heading: 'Editorial body', body: 'The editorial body follows the Markdown-enabled intro block.' }],
    },
  });
  const controlContent = JSON.parse(controlResult.stdout.trim().split('\n')[0]);
  const controlLead = controlContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text.includes('lead remains selectable'));
  assert.ok(introLead && controlLead, JSON.stringify({ introLead, controlLead }));
  assert.ok(introImage && introLead && introLead.y >= introImage.y + introImage.height - reportImageQa.report_image_geometry_tolerance, JSON.stringify({ introImage, introLead }));
  const structuredOutput = join(temporary, 'structured-report.pdf');
  const structuredResult = await runCli({
    content_root: contentRoot,
    output_path: structuredOutput,
    diagnostics: 'full',
    data: {
      title: 'Structured image report',
      sections: [{ heading: 'Map', content: [{ type: 'image', src: 'assets/map.png', alt: 'Map', caption: 'Structured caption', width: '80%', fit: 'contain' }] }],
    },
  });
  const structuredContent = JSON.parse(structuredResult.stdout.trim().split('\n')[0]);
  assert.equal(structuredContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1, JSON.stringify(structuredContent));
  const floatOutput = join(temporary, 'float-image-report.pdf');
  const floatResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: floatOutput,
    diagnostics: 'full',
    data: {
      title: 'Float image report',
      sections: [{
        heading: 'Text around an image',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Before the image, the paragraph establishes the current text flow. ' },
            { type: 'image', src: 'assets/float.svg', alt: 'Floating map', width: '60%', wrap: 'right', caption: 'Floating map' },
            { type: 'text', text: ' After the image, the paragraph must use the remaining horizontal interval and continue below the rectangular asset without entering its boundary. '.repeat(8) },
          ],
        }],
      }],
    },
  });
  const floatContent = JSON.parse(floatResult.stdout.trim().split('\n')[0]);
  const floatImage = floatContent.drawings.find((drawing) => drawing.kind === 'image');
  const floatText = floatContent.drawings.filter((drawing) => drawing.kind === 'text' && drawing.text.includes('After the image'));
  const floatBoundary = floatContent.compositionPlan?.graphicPlacements?.find((graphic) => graphic.graphicId.endsWith(':boundary'));
  const floatPlanLines = floatContent.compositionPlan?.lines?.filter((line) => line.blockId.endsWith(':part-2') && line.page === floatBoundary?.page && line.slotId === floatBoundary?.slotId) ?? [];
  assert.ok(floatImage && floatText.length > 0, JSON.stringify(floatContent.drawings));
  assert.ok(floatBoundary && floatPlanLines.length > 0, JSON.stringify({ floatBoundary, floatPlanLines }));
  assert.ok(floatPlanLines.some((line) => line.box.x + line.box.width <= floatBoundary.box.x), JSON.stringify({ floatBoundary, floatPlanLines }));
  assert.ok(floatPlanLines.every((line) => line.box.x + line.box.width <= floatBoundary.box.x + reportImageQa.report_image_geometry_tolerance || line.box.y >= floatBoundary.box.y + floatBoundary.box.height - reportImageQa.report_image_geometry_tolerance), JSON.stringify({ floatBoundary, floatPlanLines }));
  const floatPngPrefix = join(temporary, 'float-image-page');
  await execFileAsync('pdftoppm', ['-png', '-f', '1', '-singlefile', floatOutput, floatPngPrefix]);
  const floatPng = `${floatPngPrefix}.png`;
  const dimensions = (await execFileAsync('identify', ['-format', '%w %h', floatPng])).stdout.trim().split(/\s+/u).map(Number);
  const scaleX = dimensions[0] / renderConfig.pdf.page_width;
  const scaleY = dimensions[1] / renderConfig.pdf.page_height;
  const cropWidth = Math.max(1, Math.floor(floatImage.width * scaleX));
  const cropHeight = Math.max(1, Math.floor(floatImage.height * scaleY));
  const cropX = Math.max(0, Math.floor(floatImage.x * scaleX));
  const cropY = Math.max(0, Math.floor(floatImage.y * scaleY));
  const crop = ['-crop', `${cropWidth}x${cropHeight}+${cropX}+${cropY}`, '+repage'];
  const redRatio = Number((await execFileAsync('convert', [floatPng, ...crop, '-fx', `((r>${reportImageQa.report_image_red_channel_min})&&(g<${reportImageQa.report_image_green_channel_max})&&(b<${reportImageQa.report_image_blue_channel_max}))`, '-format', '%[fx:mean]', 'info:'])).stdout.trim());
  const darkRatio = Number((await execFileAsync('convert', [floatPng, ...crop, '-fx', `((r<${reportImageQa.report_image_dark_channel_max})&&(g<${reportImageQa.report_image_dark_channel_max})&&(b<${reportImageQa.report_image_dark_channel_max}))`, '-format', '%[fx:mean]', 'info:'])).stdout.trim());
  assert.ok(Number.isFinite(redRatio) && redRatio > reportImageQa.report_image_min_red_pixel_ratio, JSON.stringify({ redRatio, floatImage, dimensions }));
  assert.ok(Number.isFinite(darkRatio) && darkRatio < reportImageQa.report_image_max_dark_pixel_ratio, JSON.stringify({ darkRatio, floatImage, dimensions }));
  const fallbackResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: join(temporary, 'float-fallback-report.pdf'),
    diagnostics: 'full',
    data: {
      title: 'Float fallback report',
      sections: [{
        heading: 'Promote an oversized float',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'image', src: 'assets/float.svg', alt: 'Oversized floating map', width: '90%', wrap: 'left' },
            { type: 'text', text: 'This text must start below the image when the requested float leaves less than the configured minimum line width. '.repeat(4) },
          ],
        }],
      }],
    },
  });
  const fallbackContent = JSON.parse(fallbackResult.stdout.trim().split('\n')[0]);
  const fallbackImage = fallbackContent.drawings.find((drawing) => drawing.kind === 'image');
  const fallbackText = fallbackContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text.startsWith('This text must start below the image'));
  assert.ok(fallbackImage && fallbackText, JSON.stringify(fallbackContent.drawings));
  assert.ok(fallbackText.y >= fallbackImage.y + fallbackImage.height - reportImageQa.report_image_geometry_tolerance, JSON.stringify({ fallbackImage, fallbackText }));
  const archivePath = join(temporary, 'brand-source.zip');
  const hero = await readFile(join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'));
  const zipWebpPath = join(temporary, 'zip-map.webp');
  const zipAvifPath = join(temporary, 'zip-map.avif');
  await execFileAsync('ffmpeg', ['-v', 'error', '-i', join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'), '-frames:v', '1', zipWebpPath]);
  await execFileAsync('ffmpeg', ['-v', 'error', '-i', join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'), '-frames:v', '1', zipAvifPath]);
  const zipWebp = await readFile(zipWebpPath);
  const zipAvif = await readFile(zipAvifPath);
  await writeFile(archivePath, Buffer.from(zipSync({
    'brands/zip/_brand.yml': Buffer.from('schema_version: 1\nmeta:\n  name: ZIP\nlayout:\n  report_image_caption:\n    align: left\n    color: primary\n    padding_x: 4\n'),
    'brands/zip/profiles/primary.yml': Buffer.from('schema_version: 1\n'),
    'brands/zip/assets/map.png': hero,
    'brands/zip/assets/map.webp': zipWebp,
    'brands/zip/assets/map.avif': zipAvif,
  })));
  const zipOutput = join(temporary, 'zip-report.pdf');
  const zipResult = await runCli({
    brand_ref: 'brand://zip/profiles/primary',
    brand_source: { zip_path: archivePath, brand_path: 'brands' },
    output_path: zipOutput,
    diagnostics: 'full',
    data: { title: 'ZIP image report', sections: [{ heading: 'Map', body: '![ZIP map](brand://zip/assets/map.png "ZIP caption")' }] },
  });
  const zipContent = JSON.parse(zipResult.stdout.trim().split('\n')[0]);
  const zipImage = zipContent.drawings.find((drawing) => drawing.kind === 'image');
  const zipCaption = zipContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text === 'ZIP caption');
  assert.equal(zipContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.ok(zipImage && zipCaption && Math.abs(zipCaption.x - (zipImage.x + 4)) < 0.01, JSON.stringify(zipContent.drawings));
  for (const extension of ['webp', 'avif']) {
    const encodedZipOutput = join(temporary, `zip-${extension}-report.pdf`);
    const encodedZipResult = await runCli({
      brand_ref: 'brand://zip/profiles/primary',
      brand_source: { zip_path: archivePath, brand_path: 'brands' },
      output_path: encodedZipOutput,
      diagnostics: 'full',
      data: { title: `${extension.toUpperCase()} ZIP image report`, sections: [{ heading: 'Encoded map', body: `![ZIP ${extension} map](brand://zip/assets/map.${extension})` }] },
    });
    const encodedZip = JSON.parse(encodedZipResult.stdout.trim().split('\n')[0]);
    assert.equal(encodedZip.drawings.filter((drawing) => drawing.kind === 'image').length, 1, `${extension} image from a brand ZIP must render through the composition backend`);
    assert.equal(encodedZip.warnings, undefined, `${extension} image from a brand ZIP should not produce a fallback warning`);
  }
  console.log('report images: Markdown image rendered with caption and diagnostics passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
