import type { RenderTheme } from '../contracts/render-theme.js';
import { logicalDirection, logicalPlacement, logicalSpacing } from '../template/direction.js';
import type { PreparedAssetsManifest } from './asset-preparation.js';
import { assetPath, assetWarnings, oversizedRasterWarnings, preparedImagePath } from './assets.js';
import { DEFAULT_THEME } from './color.js';
import type { RenderComposition } from './contracts.js';
import { asString, isRecord, selectVariant, stringFromTypography, type RecordValue } from './value.js';

function resolveColor(value: unknown, palette: RecordValue, surface?: string, seen = new Set<string>()): string | undefined {
  const selected = selectVariant(value, surface);
  if (typeof selected !== 'string') return undefined;
  if (selected.startsWith('#') || selected.startsWith('rgb') || selected.startsWith('hsl')) return selected;
  if (seen.has(selected)) return undefined;
  const paletteValue = palette[selected];
  if (paletteValue === undefined) return selected;
  seen.add(selected);
  return resolveColor(paletteValue, palette, surface, seen);
}

export function brandNameFrom(document: RecordValue): string | undefined {
  const meta = document.meta;
  if (typeof meta === 'string') return meta;
  if (!isRecord(meta)) return undefined;
  return asString(meta.name) ?? asString(meta.short) ?? (isRecord(meta.name) ? asString(meta.name.short) ?? asString(meta.name.full) : undefined);
}

export function extractTheme(brandDir: string, document: RecordValue, surface: string | undefined, templateRef: string | undefined, brandSourceRoots: string[], preparedManifest?: PreparedAssetsManifest): { theme: RenderTheme; composition: RenderComposition; brandName?: string; warnings: string[] } {
  const color = isRecord(document.color) ? document.color : {};
  const palette = isRecord(color.palette) ? color.palette : {};
  const role = (name: string, fallback: string) => resolveColor(color[name], palette, surface) ?? fallback;
  const typography = isRecord(document.typography) ? document.typography : {};
  const fonts = Array.isArray(typography.fonts) ? typography.fonts : [];
  const baseFont = stringFromTypography(typography.base) ?? (isRecord(fonts[0]) ? asString(fonts[0].family) : undefined) ?? DEFAULT_THEME.fontFamily;
  const headingFont = stringFromTypography(typography.headings) ?? baseFont;
  const glyphFont = stringFromTypography(typography.glyphs);
  const namedColors = Object.values(palette).map((item) => resolveColor(item, palette, surface)).filter((item): item is string => Boolean(item));
  const series = Array.isArray(color.series)
    ? color.series.map((item) => resolveColor(item, palette, surface)).filter((item): item is string => Boolean(item))
    : [];
  const paletteValues = [...new Set(series.length > 0 ? series : namedColors)].slice(0, 8);
  const warnings: string[] = [];
  if (document.schema_version === undefined) warnings.push('Brand document has no schema_version; treated as legacy v1.');
  const fontRegularPath = assetPath(brandDir, document, 'font_regular', brandSourceRoots);
  const fontBoldPath = assetPath(brandDir, document, 'font_bold', brandSourceRoots);
  const fontGlyphRegularPath = assetPath(brandDir, document, 'font_glyph_regular', brandSourceRoots);
  const fontGlyphBoldPath = assetPath(brandDir, document, 'font_glyph_bold', brandSourceRoots);
  const glyphFontFamily = glyphFont ?? (fontGlyphRegularPath && fontGlyphBoldPath ? headingFont : baseFont);
  if (baseFont !== DEFAULT_THEME.fontFamily || headingFont !== DEFAULT_THEME.headingFontFamily) {
    warnings.push(fontRegularPath
      ? `Font '${baseFont}'/'${headingFont}' is loaded from brand assets for PDF, PNG and editable outputs.`
      : `Font '${baseFont}'/'${headingFont}' is selected for editable outputs; no font asset was provided, so raster/PDF falls back to embedded DejaVu Sans.`);
  }
  const layout = isRecord(document.layout) ? document.layout : {};
  const composition: RenderComposition = {
    templateRef: typeof layout.slide_template === 'string' && layout.slide_template.length > 0 ? layout.slide_template : 'slides/standard',
    direction: logicalDirection(layout.direction),
    lockupPlacement: logicalPlacement(layout.lockup_position),
    lockupSpacing: logicalSpacing(layout.lockup_spacing),
  };
  const headerStyle = asString(layout.header_style);
  const reportHeaderStyle = asString(layout.report_header_style) ?? headerStyle;
  const showReportBrandName = layout.show_report_brand_name !== false;
  const titleAlign = asString(layout.title_align);
  const titleCase = asString(layout.title_case);
  const titleColor = resolveColor(layout.title_color, palette, surface) ?? DEFAULT_THEME.titleColor;
  const titleAccentColor = resolveColor(layout.title_accent_color, palette, surface) ?? titleColor;
  const titleSubtitleColor = resolveColor(layout.title_subtitle_color, palette, surface) ?? titleColor;
  const titleLogoWidthPx = typeof layout.title_logo_width_px === 'number' ? Math.max(100, Math.min(320, layout.title_logo_width_px)) : DEFAULT_THEME.titleLogoWidthPx;
  const titleLogoHeightPx = typeof layout.title_logo_height_px === 'number' ? Math.max(20, Math.min(80, layout.title_logo_height_px)) : DEFAULT_THEME.titleLogoHeightPx;
  const coverBackground = resolveColor(layout.cover_background, palette, surface);
  const logoVariant = asString(layout.logo_variant);
  const backgroundImageOpacity = typeof layout.background_image_opacity === 'number' ? layout.background_image_opacity : DEFAULT_THEME.backgroundImageOpacity;
  const imageTextColor = resolveColor(layout.image_text_color, palette, surface) ?? DEFAULT_THEME.imageTextColor;
  const safeArea = isRecord(layout.image_text_safe_area) ? layout.image_text_safe_area : {};
  const imageTextSafeArea = {
    x: typeof safeArea.x === 'number' ? safeArea.x : DEFAULT_THEME.imageTextSafeArea.x,
    y: typeof safeArea.y === 'number' ? safeArea.y : DEFAULT_THEME.imageTextSafeArea.y,
    width: typeof safeArea.width === 'number' ? safeArea.width : DEFAULT_THEME.imageTextSafeArea.width,
    height: typeof safeArea.height === 'number' ? safeArea.height : DEFAULT_THEME.imageTextSafeArea.height,
  };
  if ([imageTextSafeArea.x, imageTextSafeArea.y, imageTextSafeArea.width, imageTextSafeArea.height].some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || imageTextSafeArea.width <= 0
    || imageTextSafeArea.height <= 0
    || imageTextSafeArea.x + imageTextSafeArea.width > 1
    || imageTextSafeArea.y + imageTextSafeArea.height > 1) {
    throw new Error(`Invalid layout.image_text_safe_area in ${brandDir}; values must be normalized and stay within 0..1.`);
  }
  const caption = isRecord(layout.report_image_caption) ? layout.report_image_caption : undefined;
  const captionAlign = asString(caption?.align);
  const resolvedCaptionAlign: 'left' | 'center' | 'right' | undefined = captionAlign === 'left' || captionAlign === 'right' || captionAlign === 'center' ? captionAlign : undefined;
  const reportImageCaption = caption ? {
    align: resolvedCaptionAlign,
    color: resolveColor(caption.color, palette, surface),
    size: typeof caption.size === 'number' && Number.isFinite(caption.size) && caption.size > 0 ? caption.size : undefined,
    lineHeight: typeof caption.line_height === 'number' && Number.isFinite(caption.line_height) && caption.line_height > 0 ? caption.line_height : undefined,
    baselineOffset: typeof caption.baseline_offset === 'number' && Number.isFinite(caption.baseline_offset) && caption.baseline_offset >= 0 ? caption.baseline_offset : undefined,
    gap: typeof caption.gap === 'number' && Number.isFinite(caption.gap) && caption.gap >= 0 ? caption.gap : undefined,
    paddingX: typeof caption.padding_x === 'number' && Number.isFinite(caption.padding_x) && caption.padding_x >= 0 ? caption.padding_x : undefined,
    bottomGap: typeof caption.bottom_gap === 'number' && Number.isFinite(caption.bottom_gap) && caption.bottom_gap >= 0 ? caption.bottom_gap : undefined,
  } : undefined;
  const scrim = isRecord(layout.image_scrim) ? layout.image_scrim : undefined;
  const imageScrimColor = scrim ? resolveColor(scrim.color, palette, surface) : undefined;
  const imageScrim = imageScrimColor ? { color: imageScrimColor, opacity: Math.max(0, Math.min(1, typeof scrim?.opacity === 'number' ? scrim.opacity : 0.12)) } : undefined;
  const headingScale = typeof layout.heading_scale === 'number' ? Math.max(0.5, Math.min(1.5, layout.heading_scale)) : DEFAULT_THEME.headingScale;
  const bodyScale = typeof layout.body_scale === 'number' ? Math.max(0.5, Math.min(1.5, layout.body_scale)) : DEFAULT_THEME.bodyScale;
  const pptxHeadingScale = typeof layout.pptx_heading_scale === 'number' ? Math.max(0.85, Math.min(1.15, layout.pptx_heading_scale)) : DEFAULT_THEME.pptxHeadingScale;
  warnings.push(...assetWarnings(brandDir, document, brandSourceRoots));
  warnings.push(...oversizedRasterWarnings(brandDir, document, brandSourceRoots));
  const originalBackgroundImagePath = assetPath(brandDir, document, 'background_image', brandSourceRoots);
  const originalCoverImagePath = assetPath(brandDir, document, 'cover_image', brandSourceRoots);
  const originalReportHeaderImagePath = assetPath(brandDir, document, 'report_header_image', brandSourceRoots);
  const slideSurface = templateRef?.startsWith('slides/') || surface?.startsWith('slide') || surface?.startsWith('pptx');
  const backgroundPrepared = preparedImagePath(brandDir, originalBackgroundImagePath, slideSurface ? 'slide_background' : 'report_header_band', preparedManifest);
  const coverPrepared = preparedImagePath(brandDir, originalCoverImagePath, 'cover', preparedManifest);
  const reportHeaderPrepared = preparedImagePath(brandDir, originalReportHeaderImagePath, 'report_header_band', preparedManifest);
  for (const item of [backgroundPrepared, coverPrepared, reportHeaderPrepared]) if (item.warning && !warnings.includes(item.warning)) warnings.push(item.warning);
  return {
    brandName: brandNameFrom(document),
    warnings,
    composition,
    theme: {
      ...DEFAULT_THEME,
      brandName: brandNameFrom(document),
      background: role('background', DEFAULT_THEME.background),
      foreground: role('foreground', DEFAULT_THEME.foreground),
      primary: role('primary', paletteValues[0] ?? DEFAULT_THEME.primary),
      secondary: role('secondary', paletteValues[1] ?? DEFAULT_THEME.secondary),
      muted: role('muted', DEFAULT_THEME.muted),
      line: role('line', DEFAULT_THEME.line),
      soft: role('surface', DEFAULT_THEME.soft),
      success: role('success', DEFAULT_THEME.success),
      danger: role('danger', DEFAULT_THEME.danger),
      warning: role('warning', DEFAULT_THEME.warning),
      palette: paletteValues.length >= 2 ? paletteValues : DEFAULT_THEME.palette,
      fontFamily: baseFont,
      headingFontFamily: headingFont,
      bodyScale,
      headingScale,
      pptxHeadingScale,
      headerStyle: headerStyle === 'accent-band' || headerStyle === 'dark-band' || headerStyle === 'image-band' ? headerStyle : DEFAULT_THEME.headerStyle,
      reportHeaderStyle: reportHeaderStyle === 'accent-band' || reportHeaderStyle === 'dark-band' || reportHeaderStyle === 'image-band' ? reportHeaderStyle : DEFAULT_THEME.reportHeaderStyle,
      showReportBrandName,
      titleAlign: titleAlign === 'center' ? 'center' : DEFAULT_THEME.titleAlign,
      titleCase: titleCase === 'upper' ? 'upper' : DEFAULT_THEME.titleCase,
      titleColor,
      titleAccentColor,
      titleSubtitleColor,
      titleLogoWidthPx,
      titleLogoHeightPx,
      coverBackground,
      headingWeight: typeof layout.heading_weight === 'number' ? layout.heading_weight : DEFAULT_THEME.headingWeight,
      bodyWeight: typeof layout.body_weight === 'number' ? layout.body_weight : DEFAULT_THEME.bodyWeight,
      radius: typeof layout.radius === 'number' ? layout.radius : DEFAULT_THEME.radius,
      logoVariant: logoVariant === 'white' ? 'white' : DEFAULT_THEME.logoVariant,
      logoPath: assetPath(brandDir, document, 'logo', brandSourceRoots),
      logoWhitePath: assetPath(brandDir, document, 'logo_white', brandSourceRoots),
      logoMarkPath: assetPath(brandDir, document, 'logo_mark', brandSourceRoots),
      logoWhiteMarkPath: assetPath(brandDir, document, 'logo_white_mark', brandSourceRoots),
      backgroundImagePath: backgroundPrepared.path,
      coverImagePath: coverPrepared.path,
      reportHeaderImagePath: reportHeaderPrepared.path,
      backgroundImageOpacity: Math.max(0, Math.min(1, backgroundImageOpacity)),
      imageTextColor,
      imageTextSafeArea,
      imageScrim,
      reportImageCaption,
      fontRegularPath,
      fontBoldPath,
      glyphFontFamily,
      fontGlyphRegularPath,
      fontGlyphBoldPath,
    },
  };
}
