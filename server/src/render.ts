import type { ReportConfig } from './config.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { chromium, type Browser } from 'playwright';

export interface PdfOptions {
  format?: string;
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
}

export interface ImageOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  fullPage?: boolean;
  type?: 'png' | 'jpeg';
}

export async function launchBrowser(cfg: ReportConfig): Promise<Browser> {
  return chromium.launch({
    channel: cfg.chromiumChannel,
    headless: true,
    args: ['--disable-crash-reporter', '--disable-crashpad'],
  });
}

export async function renderHtmlToPdf(
  cfg: ReportConfig,
  html: string,
  outputPath: string,
  options: PdfOptions = {},
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const browser = await launchBrowser(cfg);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: options.format,
      landscape: options.landscape,
      margin: options.margin,
      printBackground: options.printBackground ?? true,
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

export async function renderHtmlToImage(
  cfg: ReportConfig,
  html: string,
  outputPath: string,
  options: ImageOptions = {},
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const browser = await launchBrowser(cfg);
  try {
    const page = await browser.newPage({
      viewport: {
        width: options.width ?? 1280,
        height: options.height ?? 900,
      },
      deviceScaleFactor: options.deviceScaleFactor ?? 1,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: outputPath,
      fullPage: options.fullPage ?? true,
      type: options.type ?? 'png',
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

export async function renderUrlToPdf(
  cfg: ReportConfig,
  url: string,
  outputPath: string,
  options: PdfOptions = {},
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const browser = await launchBrowser(cfg);
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: options.format,
      landscape: options.landscape,
      margin: options.margin,
      printBackground: options.printBackground ?? true,
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}

export async function renderUrlToImage(
  cfg: ReportConfig,
  url: string,
  outputPath: string,
  options: ImageOptions = {},
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const browser = await launchBrowser(cfg);
  try {
    const page = await browser.newPage({
      viewport: {
        width: options.width ?? 1280,
        height: options.height ?? 900,
      },
      deviceScaleFactor: options.deviceScaleFactor ?? 1,
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: outputPath,
      fullPage: options.fullPage ?? true,
      type: options.type ?? 'png',
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}
