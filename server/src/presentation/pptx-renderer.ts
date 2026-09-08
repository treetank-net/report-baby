import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import PptxGenJS from 'pptxgenjs';
import { assetDataUri, defaultRenderTheme } from '../brand/context.js';
import type { Slide } from '../contracts/input/schema.js';
import type { RenderTheme } from '../core/model/render-theme.js';
import type { ResolvedSlidePlan } from '../core/model/resolved-slide-plan.js';
import { loadRenderFontSet, readableTextColor, renderSvgToPng } from '../rendering/primitives.js';
import { renderChart } from '../rendering/svg.js';
import type { SlideDeck } from './contracts.js';
import {
  CARD_PADDING_INCHES,
  HEIGHT,
  WIDTH,
  PPTX_HEIGHT,
  PPTX_WIDTH,
  PX_PER_INCH,
  PX_TO_PT,
  RENDER_CONFIG,
  assertTextFitsBox,
  assertTitleWithinSafeArea,
  fitMetricCard,
  fitSingleLine,
  fitTemplateText,
  fitText,
  getTitleSafeArea,
  isRtl,
  lockupGeometry,
  logicalBoxX,
  slideLayout,
  subtitleTextLimit,
  templateFitTheme,
  textBoxBaseline,
  titleTextLimit,
  pptxHeadingSize,
} from './slide-layout.js';
import { validateSlideContent } from './slide-validation.js';

async function pptxAssetDataUri(filePath: string | undefined, width: number, theme: RenderTheme): Promise<string | undefined> {
  const uri = await assetDataUri(filePath);
  const svgPrefix = 'data:image/svg+xml;base64,';
  if (!uri?.startsWith(svgPrefix)) return uri;
  const svg = Buffer.from(uri.slice(svgPrefix.length), 'base64').toString('utf8');
  const png = await renderSvgToPng(svg, width, await loadRenderFontSet(theme));
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function chartImage(slide: Extract<Slide, { type: 'chart' }>, theme: RenderTheme, width = RENDER_CONFIG.chart.width, height = RENDER_CONFIG.chart.height): Promise<string> {
  const svg = renderChart(slide.chart.type, { ...slide.chart, width, height, theme, data: slide.chart.data.map((datum, index) => ({ ...datum, color: datum.color ?? theme.palette[index % theme.palette.length] })) });
  const png = await renderSvgToPng(svg, width, await loadRenderFontSet(theme));
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function addPptxHeader(pptxSlide: PptxGenJS.Slide, shapeType: PptxGenJS['ShapeType'], deck: SlideDeck, slide: Exclude<Slide, { type: 'title' }>, theme: RenderTheme, plan?: ResolvedSlidePlan): Promise<void> {
  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoMarkPath = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoMarkPath : theme.logoMarkPath;
  const [logo, logoMark] = await Promise.all([pptxAssetDataUri(logoPath, RENDER_CONFIG.pptx.logo_raster_width, theme), pptxAssetDataUri(logoMarkPath, RENDER_CONFIG.pptx.logo_raster_width, theme)]);
  const band = theme.headerStyle === 'accent-band' ? theme.primary : theme.headerStyle === 'dark-band' ? theme.background : undefined;
  const layout = slideLayout(theme, plan);
  const headerTitleBox = plan?.sourceTemplate ? plan.slots.title : { x: RENDER_CONFIG.spacing.margin, y: layout.headerTitleY - RENDER_CONFIG.legacy.header_title_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.header_title_box_height };
  const headerSubtitleBox = plan?.sourceTemplate ? plan.slots.subtitle : { x: RENDER_CONFIG.spacing.margin, y: layout.headerSubtitleY - RENDER_CONFIG.legacy.header_subtitle_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.header_subtitle_box_height };
  const headerFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, RENDER_CONFIG.typography.headerTitle, Math.max(RENDER_CONFIG.legacy.header_title_min_chars, Math.floor(headerTitleBox.width / (RENDER_CONFIG.typography.headerTitle * RENDER_CONFIG.text.headingGlyphWidth))), plan?.titleConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.titleConstraints.overflow));
  if (headerFit.overflow) throw new Error(`Slide heading does not fit within the safe header area: ${slide.title}`);
  if (band) pptxSlide.addShape(shapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: layout.headerLineY / PX_PER_INCH, fill: { color: band.slice(1) }, line: { color: band.slice(1), transparency: 100 } });
  const lockup = lockupGeometry(slide, theme, deck.brand, plan);
  if (logoMark) pptxSlide.addImage({ data: logoMark, x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH, transparency: 0 });
  else if (logo) {
    const logoWidth = RENDER_CONFIG.legacy.regular_logo_width / PX_PER_INCH;
    const x = plan?.lockup.physicalSide === 'right' ? (WIDTH - RENDER_CONFIG.spacing.margin - RENDER_CONFIG.legacy.regular_logo_width) / PX_PER_INCH : plan?.titleAlign === 'center' ? (WIDTH - RENDER_CONFIG.legacy.regular_logo_width) / 2 / PX_PER_INCH : RENDER_CONFIG.spacing.margin / PX_PER_INCH;
    const y = lockup.markY / PX_PER_INCH;
    const logoHeight = RENDER_CONFIG.legacy.regular_logo_height / PX_PER_INCH;
    pptxSlide.addImage({ data: logo, x, y, w: logoWidth, h: logoHeight, sizing: { type: 'contain', x, y, w: logoWidth, h: logoHeight }, transparency: 0 });
  }
  const headerColor = band ? readableTextColor(band, theme, RENDER_CONFIG.typography.headerTitle, true).slice(1) : theme.headerStyle === 'image-band' ? theme.imageTextColor.slice(1) : theme.foreground.slice(1);
  if (logoMark && deck.brand) {
    const nameBox = plan?.sourceTemplate ? plan.lockup.name : { x: lockup.nameAnchor === 'end' ? lockup.nameX - RENDER_CONFIG.chrome.lockup.standard.nameWidthPx : lockup.nameX, y: lockup.nameY - RENDER_CONFIG.pptx.brand_name_box_y_adjustment, width: RENDER_CONFIG.chrome.lockup.standard.nameWidthPx, height: RENDER_CONFIG.chrome.lockup.standard.nameHeightPx };
    if (plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand.toUpperCase()], size: lockup.nameSize, lineHeight: lockup.nameSize, overflow: false }, plan.lockup.name, lockup.nameY, theme.fontFamily);
    pptxSlide.addText(deck.brand.toUpperCase(), { x: nameBox.x / PX_PER_INCH, y: (lockup.nameY - lockup.nameSize) / PX_PER_INCH, w: nameBox.width / PX_PER_INCH, h: (lockup.nameSize * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: lockup.nameSize * PX_TO_PT * theme.pptxHeadingScale, bold: true, color: headerColor, align: lockup.nameAnchor === 'end' ? 'right' : 'left', margin: 0, valign: 'top' });
  }
  const headerAlign: 'left' | 'center' | 'right' = plan?.titleAlign === 'right' || plan?.direction === 'rtl' ? 'right' : plan?.titleAlign === 'center' ? 'center' : 'left';
  const headerTitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerTitleBox, headerFit.size) : layout.headerTitleY;
  assertTextFitsBox('Slide heading', headerFit, headerTitleBox, headerTitleBaseline, theme.headingFontFamily);
  pptxSlide.addText(headerFit.lines.join('\n'), { x: headerTitleBox.x / PX_PER_INCH, y: (headerTitleBaseline - headerFit.size) / PX_PER_INCH, w: headerTitleBox.width / PX_PER_INCH, h: (headerFit.lines.length * headerFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: theme.headingFontFamily, fontSize: headerFit.size * PX_TO_PT * theme.pptxHeadingScale, bold: true, color: headerColor, align: headerAlign, margin: 0, valign: 'top' });
  if (slide.subtitle) {
    const subtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale, Math.max(RENDER_CONFIG.legacy.header_subtitle_min_chars, Math.floor(headerSubtitleBox.width / (RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale * RENDER_CONFIG.text.bodyGlyphWidth))), plan?.subtitleConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
    if (subtitleFit.overflow) throw new Error(`Slide subtitle does not fit within the safe header area: ${slide.subtitle}`);
    const headerSubtitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerSubtitleBox, subtitleFit.size) : layout.headerSubtitleY;
    assertTextFitsBox('Slide subtitle', subtitleFit, headerSubtitleBox, headerSubtitleBaseline, theme.fontFamily);
    pptxSlide.addText(subtitleFit.lines.join('\n'), { x: headerSubtitleBox.x / PX_PER_INCH, y: (headerSubtitleBaseline - subtitleFit.size) / PX_PER_INCH, w: headerSubtitleBox.width / PX_PER_INCH, h: (subtitleFit.lines.length * subtitleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: subtitleFit.size * PX_TO_PT, color: band ? readableTextColor(band, theme, subtitleFit.size, false).slice(1) : theme.headerStyle === 'image-band' ? theme.imageTextColor.slice(1) : theme.muted.slice(1), align: headerAlign, margin: 0, valign: 'top' });
  }
  const headerBox = plan?.slots.header ?? { x: RENDER_CONFIG.spacing.margin, y: 0, width: RENDER_CONFIG.spacing.contentWidth, height: layout.headerLineY };
  if (!band) pptxSlide.addShape(shapeType.line, { x: headerBox.x / PX_PER_INCH, y: layout.headerLineY / PX_PER_INCH, w: headerBox.width / PX_PER_INCH, h: 0, line: { color: theme.headerStyle === 'image-band' ? 'FFFFFF' : theme.line.slice(1), width: 1, transparency: theme.headerStyle === 'image-band' ? 50 : 0 } });
}

function addPptxFooter(pptxSlide: PptxGenJS.Slide, shapeType: PptxGenJS['ShapeType'], deck: SlideDeck, index: number, theme: RenderTheme, graphic: boolean, plan?: ResolvedSlidePlan): void {
  const footerBox = plan?.slots.footer ?? { x: RENDER_CONFIG.spacing.margin, y: RENDER_CONFIG.spacing.footerY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.spacing.footerHeight };
  const footerLineColor = (graphic ? theme.imageTextColor : theme.line).slice(1);
  const footerTextColor = (graphic ? theme.titleSubtitleColor : theme.muted).slice(1);
  pptxSlide.addShape(shapeType.line, { x: footerBox.x / PX_PER_INCH, y: footerBox.y / PX_PER_INCH, w: footerBox.width / PX_PER_INCH, h: 0, line: { color: footerLineColor, width: 1, transparency: graphic ? 35 : 0 } });
  const footer = deck.slideFooters?.[index] ?? deck.footer;
  if (footer) pptxSlide.addText(fitSingleLine(footer, footerBox.width - RENDER_CONFIG.legacy.footer_text_padding * 2, RENDER_CONFIG.typography.footer, theme.fontFamily), { x: footerBox.x / PX_PER_INCH, y: (footerBox.y + RENDER_CONFIG.legacy.footer_text_padding) / PX_PER_INCH, w: (footerBox.width - RENDER_CONFIG.legacy.footer_text_width) / PX_PER_INCH, h: RENDER_CONFIG.typography.footer * RENDER_CONFIG.text.lineHeight / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: RENDER_CONFIG.typography.footer * PX_TO_PT, color: footerTextColor, margin: 0, valign: 'top', align: plan?.direction === 'rtl' ? 'right' : 'left' });
  pptxSlide.addText(`${index + 1} / ${deck.slides.length}`, { x: (footerBox.x + footerBox.width - RENDER_CONFIG.legacy.footer_number_width) / PX_PER_INCH, y: (footerBox.y + RENDER_CONFIG.legacy.footer_text_padding) / PX_PER_INCH, w: RENDER_CONFIG.legacy.footer_number_width / PX_PER_INCH, h: RENDER_CONFIG.typography.footer * RENDER_CONFIG.text.lineHeight / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: RENDER_CONFIG.typography.footer * PX_TO_PT, color: footerTextColor, align: 'right', margin: 0, valign: 'top' });
}

export async function renderSlidesPptx(deck: SlideDeck, theme = defaultRenderTheme()): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'TreeTank report-baby';
  pptx.subject = deck.title ?? 'Presentation';
  pptx.title = deck.title ?? deck.slides[0]?.title ?? 'Presentation';
  pptx.company = deck.brand ?? 'TreeTank';
  for (let index = 0; index < deck.slides.length; index++) {
    const content = deck.slides[index];
    validateSlideContent(content);
    const slide = pptx.addSlide();
    if (content.notes) slide.addNotes(content.notes);
    const slideTheme = deck.slideThemes?.[index] ?? theme;
    const plan = deck.slidePlans?.[index];
    const titleAlign = plan?.titleAlign ?? slideTheme.titleAlign;
    slide.background = { color: slideTheme.background.slice(1) };
    const logoPath = slideTheme.logoVariant === 'white' ? slideTheme.logoWhitePath ?? slideTheme.logoPath : slideTheme.logoPath;
    const logoMarkPath = slideTheme.logoVariant === 'white' ? slideTheme.logoWhiteMarkPath ?? slideTheme.logoMarkPath : slideTheme.logoMarkPath;
    const [logo, logoMark] = await Promise.all([pptxAssetDataUri(logoPath, RENDER_CONFIG.pptx.logo_raster_width, slideTheme), pptxAssetDataUri(logoMarkPath, RENDER_CONFIG.pptx.logo_raster_width, slideTheme)]);
    const background = await pptxAssetDataUri(slideTheme.backgroundImagePath, RENDER_CONFIG.canvas.width, slideTheme);
    const cover = content.type === 'title' ? await pptxAssetDataUri(slideTheme.coverImagePath, RENDER_CONFIG.canvas.width, slideTheme) : undefined;
    const graphicContentColor = Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background)) ? slideTheme.imageTextColor.slice(1) : slideTheme.foreground.slice(1);
    const slideLayoutValues = slideLayout(slideTheme, plan);
    if (background && slideTheme.headerStyle === 'image-band') {
      const imageArea = plan?.slots.image;
      const imageX = imageArea ? imageArea.x / PX_PER_INCH : 0;
      const imageY = imageArea ? imageArea.y / PX_PER_INCH : 0;
      const imageW = imageArea ? imageArea.width / PX_PER_INCH : PPTX_WIDTH;
      const imageH = imageArea ? imageArea.height / PX_PER_INCH : PPTX_HEIGHT;
      slide.addImage({ data: background, x: imageX, y: imageY, w: imageW, h: imageH, sizing: { type: 'cover', x: imageX, y: imageY, w: imageW, h: imageH }, transparency: Math.round((1 - slideTheme.backgroundImageOpacity) * 100) });
      if (slideTheme.imageScrim) {
        const area = slideTheme.imageTextSafeArea;
        slide.addShape(pptx.ShapeType.roundRect, { x: area.x * PPTX_WIDTH, y: area.y * PPTX_HEIGHT, w: area.width * PPTX_WIDTH, h: area.height * PPTX_HEIGHT, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.imageScrim.color.slice(1), transparency: Math.round((1 - slideTheme.imageScrim.opacity) * 100) }, line: { color: slideTheme.imageScrim.color.slice(1), transparency: 100 } });
      }
    }
    if (cover) {
      slide.addImage({ data: cover, x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT, sizing: { type: 'cover', x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT }, transparency: 0 });
      if (slideTheme.imageScrim) {
        const area = slideTheme.imageTextSafeArea;
        slide.addShape(pptx.ShapeType.roundRect, { x: area.x * PPTX_WIDTH, y: area.y * PPTX_HEIGHT, w: area.width * PPTX_WIDTH, h: area.height * PPTX_HEIGHT, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.imageScrim.color.slice(1), transparency: Math.round((1 - slideTheme.imageScrim.opacity) * 100) }, line: { color: slideTheme.imageScrim.color.slice(1), transparency: 100 } });
      }
    }
    if (slideTheme.headerStyle === 'accent-band' && !cover) slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: slideLayoutValues.headerLineY / PX_PER_INCH, fill: { color: slideTheme.primary.slice(1) }, line: { color: slideTheme.primary.slice(1), transparency: 100 } });
    if (slideTheme.headerStyle === 'dark-band' && !cover) slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: slideLayoutValues.headerLineY / PX_PER_INCH, fill: { color: slideTheme.background.slice(1) }, line: { color: slideTheme.background.slice(1), transparency: 100 } });
    if (content.type === 'title') {
      const lockup = lockupGeometry(content, slideTheme, deck.brand, plan);
      const titleEyebrowY = plan?.titleLayout.eyebrowY ?? RENDER_CONFIG.fallbacks.title_eyebrow_y;
      const titleY = plan?.titleLayout.titleBaselineY ?? RENDER_CONFIG.legacy.title_baseline_y;
      if (logoMark) slide.addImage({ data: logoMark, x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH, sizing: { type: 'contain', x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH }, transparency: 0 });
      else if (logo) {
        const logoW = slideTheme.titleLogoWidthPx / PX_PER_INCH;
        const logoH = slideTheme.titleLogoHeightPx / PX_PER_INCH;
        const logoX = plan?.lockup.physicalSide === 'right' ? PPTX_WIDTH - RENDER_CONFIG.legacy.title_logo_right_inset / PX_PER_INCH - logoW : titleAlign === 'center' ? (PPTX_WIDTH - logoW) / 2 : RENDER_CONFIG.legacy.title_logo_left_inset / PX_PER_INCH;
        const logoY = RENDER_CONFIG.legacy.title_logo_y / PX_PER_INCH;
        slide.addImage({ data: logo, x: logoX, y: logoY, w: logoW, h: logoH, sizing: { type: 'contain', x: logoX, y: logoY, w: logoW, h: logoH }, transparency: 0 });
      }
      const graphicTitle = Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background));
      const titleColor = graphicTitle ? slideTheme.imageTextColor.slice(1) : slideTheme.foreground.slice(1);
      const safeArea = getTitleSafeArea(slideTheme, plan);
      const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');
      const titleBox = typedSource && plan?.slots.title ? { x: plan.slots.title.x / WIDTH, y: plan.slots.title.y / HEIGHT, width: plan.slots.title.width / WIDTH, height: plan.slots.title.height / HEIGHT } : safeArea;
      const titleBoxX = titleBox.x * PPTX_WIDTH;
      const titleBoxWidth = titleBox.width * PPTX_WIDTH;
      const titleMaxChars = titleTextLimit(slideTheme, titleBox, RENDER_CONFIG.typography.title, RENDER_CONFIG.legacy.title_max_chars, graphicTitle);
      const titleFit = fitText(slideTheme.titleCase === 'upper' ? content.title.toUpperCase() : content.title, RENDER_CONFIG.typography.title, titleMaxChars, plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.titleMaxLines, templateFitTheme(slideTheme, plan?.titleConstraints.overflow));
      if (titleFit.overflow) throw new Error(`Slide title does not fit within the safe title area: ${content.title}`);
      assertTextFitsBox('Slide title', titleFit, { x: titleBox.x * WIDTH, y: titleBox.y * HEIGHT, width: titleBox.width * WIDTH, height: titleBox.height * HEIGHT }, titleY, slideTheme.headingFontFamily);
      const subtitleBox = typedSource && plan?.slots.subtitle ? { x: plan.slots.subtitle.x / WIDTH, y: plan.slots.subtitle.y / HEIGHT, width: plan.slots.subtitle.width / WIDTH, height: plan.slots.subtitle.height / HEIGHT } : safeArea;
      const subtitleFit = content.subtitle ? fitText(content.subtitle, RENDER_CONFIG.typography.subtitle * slideTheme.bodyScale, subtitleTextLimit(slideTheme, subtitleBox, RENDER_CONFIG.typography.subtitle * slideTheme.bodyScale, RENDER_CONFIG.legacy.subtitle_max_chars, graphicTitle), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.subtitleMaxLines, templateFitTheme(slideTheme, plan?.subtitleConstraints.overflow), slideTheme.minBodyPt) : undefined;
      if (subtitleFit?.overflow) throw new Error(`Slide subtitle does not fit within the safe title area: ${content.subtitle}`);
      if (subtitleFit) assertTextFitsBox('Slide subtitle', subtitleFit, { x: subtitleBox.x * WIDTH, y: subtitleBox.y * HEIGHT, width: subtitleBox.width * WIDTH, height: subtitleBox.height * HEIGHT }, plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap), slideTheme.fontFamily);
      assertTitleWithinSafeArea(slideTheme, titleFit, subtitleFit, plan);
      const titleSubtitleY = plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap);
      if (logoMark && deck.brand) {
        const nameBox = plan?.sourceTemplate ? plan.lockup.name : { x: lockup.nameAnchor === 'end' ? lockup.nameX - RENDER_CONFIG.chrome.lockup.title.nameWidthPx : lockup.nameX, y: lockup.nameY - RENDER_CONFIG.pptx.brand_name_box_y_adjustment, width: RENDER_CONFIG.chrome.lockup.title.nameWidthPx, height: RENDER_CONFIG.chrome.lockup.title.nameHeightPx };
        if (plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand], size: lockup.nameSize, lineHeight: lockup.nameSize, overflow: false }, plan.lockup.name, lockup.nameY, slideTheme.headingFontFamily);
        slide.addText(deck.brand, { x: nameBox.x / PX_PER_INCH, y: (lockup.nameY - lockup.nameSize) / PX_PER_INCH, w: nameBox.width / PX_PER_INCH, h: (lockup.nameSize * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: pptxHeadingSize(lockup.nameSize, slideTheme), bold: true, color: titleColor, align: lockup.nameAnchor === 'end' ? 'right' : 'left', margin: 0, valign: 'top' });
      }
      const eyebrowFit = fitText(content.eyebrow ?? deck.brand ?? '', RENDER_CONFIG.typography.eyebrow, RENDER_CONFIG.legacy.title_eyebrow_max_chars, plan?.eyebrowConstraints.maxLines ?? 1, templateFitTheme(slideTheme, plan?.eyebrowConstraints.overflow), slideTheme.minBodyPt);
      if (eyebrowFit.overflow) throw new Error(`Slide eyebrow does not fit within the template slot: ${content.eyebrow ?? deck.brand}`);
      const eyebrowBox = typedSource && plan?.slots.eyebrow ? { x: plan.slots.eyebrow.x / WIDTH, y: plan.slots.eyebrow.y / HEIGHT, width: plan.slots.eyebrow.width / WIDTH, height: plan.slots.eyebrow.height / HEIGHT } : titleBox;
      assertTextFitsBox('Slide eyebrow', eyebrowFit, { x: eyebrowBox.x * WIDTH, y: eyebrowBox.y * HEIGHT, width: eyebrowBox.width * WIDTH, height: eyebrowBox.height * HEIGHT }, titleEyebrowY, slideTheme.fontFamily);
      slide.addText(eyebrowFit.lines.join('\n'), { x: eyebrowBox.x * PPTX_WIDTH, y: (titleEyebrowY - eyebrowFit.size) / PX_PER_INCH, w: eyebrowBox.width * PPTX_WIDTH, h: (eyebrowFit.lines.length * eyebrowFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: eyebrowFit.size * PX_TO_PT, bold: true, color: graphicTitle ? slideTheme.imageTextColor.slice(1) : slideTheme.primary.slice(1), align: titleAlign, margin: 0, valign: 'top' });
      slide.addText(titleFit.lines.join('\n'), { x: titleBoxX, y: (titleY - titleFit.size) / PX_PER_INCH, w: titleBoxWidth, h: (titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: titleFit.size * PX_TO_PT * slideTheme.pptxHeadingScale, bold: true, color: titleColor, align: titleAlign, valign: 'top', margin: 0, breakLine: false });
      if (subtitleFit) slide.addText(subtitleFit.lines.join('\n'), { x: subtitleBox.x * PPTX_WIDTH, y: (titleSubtitleY - subtitleFit.size) / PX_PER_INCH, w: subtitleBox.width * PPTX_WIDTH, h: (subtitleFit.lines.length * subtitleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: subtitleFit.size * PX_TO_PT, color: graphicTitle ? slideTheme.imageTextColor.slice(1) : slideTheme.muted.slice(1), align: titleAlign, valign: 'top', margin: 0 });
    } else {
      await addPptxHeader(slide, pptx.ShapeType, deck, content, slideTheme, plan);
      if (content.type === 'metrics') {
        const brandMetrics = Boolean(plan?.slots['metric-1']);
        if (plan?.sourceTemplate?.archetype === 'metrics' && content.metrics.length !== 3) throw new Error(`Template '${plan.templateRef}' requires exactly three metrics.`);
        const cols = Math.min(3, content.metrics.length);
        content.metrics.forEach((metric, metricIndex) => {
          const pixelGap = RENDER_CONFIG.spacing.cardGap;
          const cardWidth = (RENDER_CONFIG.spacing.contentWidth - pixelGap * (cols - 1)) / cols;
          const cardHeight = Math.min(RENDER_CONFIG.metrics.maxHeight, (RENDER_CONFIG.metrics.usableHeight - pixelGap * (Math.ceil(content.metrics.length / cols) - 1)) / Math.ceil(content.metrics.length / cols));
          const sourceBox = brandMetrics ? plan?.slots[`metric-${metricIndex + 1}`] : undefined;
          if (brandMetrics && !sourceBox) throw new Error(`Template '${plan?.templateRef ?? 'resolved slide'}' is missing metric-${metricIndex + 1}.`);
          const rawX = RENDER_CONFIG.spacing.margin + (metricIndex % cols) * (cardWidth + pixelGap);
          const pixelX = sourceBox?.x ?? logicalBoxX(rawX, cardWidth, plan);
          const pixelY = sourceBox?.y ?? slideLayout(slideTheme, plan).contentTop + Math.floor(metricIndex / cols) * (cardHeight + pixelGap);
          const pixelW = sourceBox?.width ?? cardWidth;
          const pixelH = sourceBox?.height ?? cardHeight;
          const metricFit = fitMetricCard(metric, { x: pixelX, y: pixelY, width: pixelW, height: pixelH }, slideTheme);
          const x = pixelX / PX_PER_INCH;
          const y = pixelY / PX_PER_INCH;
          const w = pixelW / PX_PER_INCH;
          const h = pixelH / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.line.slice(1), width: 1 } });
          const textAlign = isRtl(plan) ? 'right' : 'left';
          slide.addText(metricFit.label.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (pixelY + pixelH * RENDER_CONFIG.metrics.labelBaseline - metricFit.label.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: metricFit.label.lineHeight / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: metricFit.label.size * PX_TO_PT, bold: true, color: slideTheme.muted.slice(1), align: textAlign, margin: 0, valign: 'top' });
          slide.addText(metricFit.value.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (pixelY + pixelH * RENDER_CONFIG.metrics.valueBaseline - metricFit.value.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: metricFit.value.lineHeight / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: metricFit.value.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: textAlign, margin: 0, valign: 'top' });
          if (metricFit.delta ?? metricFit.note) {
            const fit = metricFit.delta ?? metricFit.note!;
            const baseline = metricFit.delta ? pixelY + pixelH * RENDER_CONFIG.metrics.deltaBaseline : pixelY + pixelH - RENDER_CONFIG.metrics.noteBottom;
            slide.addText(fit.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (baseline - fit.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: fit.lineHeight / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: fit.size * PX_TO_PT, bold: Boolean(metricFit.delta), color: metric.trend === 'down' ? slideTheme.danger.slice(1) : metric.trend === 'up' ? slideTheme.success.slice(1) : slideTheme.muted.slice(1), align: textAlign, margin: 0, valign: 'top' });
          }
        });
        const metricsLayout = slideLayout(slideTheme, plan);
        const bodyBox = brandMetrics ? plan?.slots.body : undefined;
        if (content.body) {
          const box = bodyBox ?? { x: RENDER_CONFIG.spacing.margin, y: metricsLayout.contentTop + RENDER_CONFIG.fallbacks.metrics_body_y_offset, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.metrics_body_height };
          const body = fitTemplateText('Metrics body', content.body, box, Math.round(RENDER_CONFIG.typography.body * slideTheme.bodyScale), plan?.slotRules.body?.maxLines ?? 3, plan?.slotRules.body?.overflow, plan?.slotRules.body?.verticalAlign, slideTheme, slideTheme.fontFamily);
          slide.addText(body.fit.lines.join('\n'), { x: box.x / PX_PER_INCH, y: (body.baseline - body.fit.size) / PX_PER_INCH, w: box.width / PX_PER_INCH, h: (body.fit.lines.length * body.fit.lineHeight + body.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: body.fit.size * PX_TO_PT, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, breakLine: false, valign: 'top' });
        }
        if (content.callout) {
          const calloutBox = brandMetrics ? plan?.slots.callout : undefined;
          const calloutX = calloutBox?.x ?? RENDER_CONFIG.spacing.margin;
          const calloutY = calloutBox?.y ?? metricsLayout.contentTop + RENDER_CONFIG.fallbacks.metrics_callout_y_offset;
          const calloutW = calloutBox?.width ?? RENDER_CONFIG.spacing.contentWidth;
          const calloutH = calloutBox?.height ?? RENDER_CONFIG.metrics.calloutHeight;
          slide.addShape(pptx.ShapeType.roundRect, { x: calloutX / PX_PER_INCH, y: calloutY / PX_PER_INCH, w: calloutW / PX_PER_INCH, h: calloutH / PX_PER_INCH, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.primary.slice(1), width: 1 } });
          const callout = fitTemplateText('Metrics callout', content.callout, { x: calloutX + RENDER_CONFIG.metrics.calloutPaddingX, y: calloutY + RENDER_CONFIG.metrics.calloutPaddingY, width: calloutW - RENDER_CONFIG.metrics.calloutPaddingX * 2, height: calloutH - RENDER_CONFIG.metrics.calloutPaddingY * 2 }, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules.callout?.maxLines ?? 2, plan?.slotRules.callout?.overflow, plan?.slotRules.callout?.verticalAlign, slideTheme, slideTheme.fontFamily);
          slide.addText(callout.fit.lines.join('\n'), { x: (calloutX + RENDER_CONFIG.metrics.calloutPaddingX) / PX_PER_INCH, y: (callout.baseline - callout.fit.size) / PX_PER_INCH, w: (calloutW - RENDER_CONFIG.metrics.calloutPaddingX * 2) / PX_PER_INCH, h: (callout.fit.lines.length * callout.fit.lineHeight + callout.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: callout.fit.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        }
      } else if (content.type === 'columns') {
        const legacy = RENDER_CONFIG.legacy;
        const contentLayout = slideLayout(slideTheme, plan);
        const fallbackBoxes = [
          { x: RENDER_CONFIG.spacing.margin, y: contentLayout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: contentLayout.contentBottom - contentLayout.contentTop - legacy.columns_fallback_height_padding },
          { x: RENDER_CONFIG.spacing.margin + legacy.columns_fallback_width + legacy.columns_fallback_x_gap, y: contentLayout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: contentLayout.contentBottom - contentLayout.contentTop - legacy.columns_fallback_height_padding },
        ];
        content.columns.forEach((column, columnIndex) => {
          const box = plan?.slots[columnIndex === 0 ? 'left' : 'right'] ?? fallbackBoxes[columnIndex]!;
          const x = box.x / PX_PER_INCH;
          const y = box.y / PX_PER_INCH;
          const w = box.width / PX_PER_INCH;
          const h = box.height / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.line.slice(1), width: 1 } });
          const inner = { x: box.x + RENDER_CONFIG.spacing.columnPadding, y: box.y + RENDER_CONFIG.fallbacks.columns_inner_padding_y, width: box.width - RENDER_CONFIG.spacing.columnPadding * 2, height: box.height - RENDER_CONFIG.fallbacks.columns_inner_padding_y * 2 };
          const slotId = columnIndex === 0 ? 'left' : 'right';
          const heading = column.heading ?? `Column ${columnIndex + 1}`;
          const headingFit = fitTemplateText(`Column ${columnIndex + 1} heading`, heading, { ...inner, height: legacy.columns_heading_height }, Math.round(RENDER_CONFIG.fallbacks.columns_heading_size * slideTheme.headingScale), 2, plan?.slotRules[slotId]?.overflow, plan?.slotRules[slotId]?.verticalAlign, slideTheme, slideTheme.headingFontFamily);
          slide.addText(headingFit.fit.lines.join('\n'), { x: inner.x / PX_PER_INCH, y: (headingFit.baseline - headingFit.fit.size) / PX_PER_INCH, w: inner.width / PX_PER_INCH, h: (headingFit.fit.lines.length * headingFit.fit.lineHeight + headingFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: headingFit.fit.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
          const bodyBox = { x: inner.x, y: box.y + legacy.columns_body_top, width: inner.width, height: box.height - legacy.columns_body_bottom_padding };
          const bodyValue = [column.body, ...(column.highlights ?? []).map((item) => `• ${item}`)].join('\n');
          const bodyFit = fitTemplateText(`Column ${columnIndex + 1} body`, bodyValue, bodyBox, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules[slotId]?.maxLines ?? 12, plan?.slotRules[slotId]?.overflow, plan?.slotRules[slotId]?.verticalAlign, slideTheme, slideTheme.fontFamily);
          slide.addText(bodyFit.fit.lines.join('\n'), { x: bodyBox.x / PX_PER_INCH, y: (bodyFit.baseline - bodyFit.fit.size) / PX_PER_INCH, w: bodyBox.width / PX_PER_INCH, h: (bodyFit.fit.lines.length * bodyFit.fit.lineHeight + bodyFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: bodyFit.fit.size * PX_TO_PT, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        });
      } else if (content.type === 'chart') {
        const chart = slideLayout(slideTheme, plan).chart;
        slide.addImage({ data: await chartImage(content, slideTheme), x: chart.x / PX_PER_INCH, y: chart.y / PX_PER_INCH, w: chart.width / PX_PER_INCH, h: chart.height / PX_PER_INCH });
      } else if (content.type === 'table') {
        const table = slideLayout(slideTheme, plan).table;
        const tableRows = [content.head.map((cell) => ({ text: String(cell), options: { bold: true, color: readableTextColor(slideTheme.primary, slideTheme, RENDER_CONFIG.pptx.table_font_size / PX_TO_PT, true).slice(1), fill: { color: slideTheme.primary.slice(1) } } })), ...content.body.slice(0, 10).map((row, rowIndex) => row.map((cell) => ({ text: String(cell), options: { color: slideTheme.foreground.slice(1), fill: { color: (rowIndex % 2 ? slideTheme.soft : slideTheme.background).slice(1) } } })) )];
        slide.addTable(isRtl(plan) ? tableRows.map((row) => [...row].reverse()) : tableRows, { x: table.x / PX_PER_INCH, y: table.y / PX_PER_INCH, w: table.width / PX_PER_INCH, h: table.height / PX_PER_INCH, border: { type: 'solid', color: slideTheme.line.slice(1), pt: 1 }, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.pptx.table_font_size * slideTheme.bodyScale, color: slideTheme.foreground.slice(1), margin: RENDER_CONFIG.legacy.default_text_padding / PX_PER_INCH, bold: false, rowH: RENDER_CONFIG.pptx.table_row_height_inches });
      } else if (content.type === 'narrative') {
        const narrativeLayout = slideLayout(slideTheme, plan);
        const narrativeBox = plan?.slots.narrative ?? { x: RENDER_CONFIG.spacing.margin, y: narrativeLayout.narrativeY - RENDER_CONFIG.fallbacks.narrative_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.narrative_fallback_height };
        const narrativeFit = fitTemplateText('Narrative body', content.body, narrativeBox, Math.round(RENDER_CONFIG.typography.narrative * slideTheme.bodyScale), plan?.slotRules.narrative?.maxLines ?? 5, plan?.slotRules.narrative?.overflow, plan?.slotRules.narrative?.verticalAlign, slideTheme, slideTheme.fontFamily);
        slide.addText(narrativeFit.fit.lines.join('\n'), { x: narrativeBox.x / PX_PER_INCH, y: (narrativeFit.baseline - narrativeFit.fit.size) / PX_PER_INCH, w: narrativeBox.width / PX_PER_INCH, h: (narrativeFit.fit.lines.length * narrativeFit.fit.lineHeight + narrativeFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: narrativeFit.fit.size * PX_TO_PT, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', breakLine: false, valign: 'top', margin: 0 });
        (content.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => {
          const highlightBox = plan?.slots[`narrative-highlight-${itemIndex + 1}`] ?? { x: RENDER_CONFIG.legacy.narrative_highlight_x, y: RENDER_CONFIG.legacy.narrative_highlight_y + itemIndex * RENDER_CONFIG.legacy.narrative_highlight_step, width: RENDER_CONFIG.legacy.narrative_highlight_width, height: RENDER_CONFIG.legacy.narrative_highlight_height };
          const fit = fitTemplateText(`Narrative highlight ${itemIndex + 1}`, item, highlightBox, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.maxLines ?? 1, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.overflow, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.verticalAlign, slideTheme, slideTheme.fontFamily);
          slide.addText([{ text: item, options: { bullet: { indent: RENDER_CONFIG.pptx.bullet_indent }, bold: true } }], { x: highlightBox.x / PX_PER_INCH, y: (fit.baseline - fit.fit.size) / PX_PER_INCH, w: highlightBox.width / PX_PER_INCH, h: (fit.fit.lines.length * fit.fit.lineHeight + fit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: fit.fit.size * PX_TO_PT, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', rtlMode: isRtl(plan), margin: 0, valign: 'top' });
        });
      } else if (content.type === 'conclusions') {
        const conclusionsLayout = slideLayout(slideTheme, plan);
        content.items.slice(0, 7).forEach((item, itemIndex) => {
          const y = (conclusionsLayout.conclusionsY + itemIndex * RENDER_CONFIG.legacy.conclusion_step) / PX_PER_INCH;
          const color = slideTheme.palette[itemIndex % slideTheme.palette.length].slice(1);
          const iconX = (isRtl(plan) ? RENDER_CONFIG.legacy.conclusion_icon_x_rtl : RENDER_CONFIG.legacy.conclusion_icon_x_ltr) / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x: iconX, y: (y - RENDER_CONFIG.legacy.conclusion_icon_y_adjustment / PX_PER_INCH), w: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, h: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, rectRadius: RENDER_CONFIG.pptx.conclusion_icon_rect_radius_inches, fill: { color }, line: { color } });
          slide.addText(String(itemIndex + 1), { x: iconX, y: (y * PX_PER_INCH - RENDER_CONFIG.legacy.conclusion_number_size) / PX_PER_INCH, w: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, h: (RENDER_CONFIG.legacy.conclusion_number_size * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.legacy.conclusion_number_size * PX_TO_PT, bold: true, color: slideTheme.background.slice(1), align: 'center', margin: 0, valign: 'top' });
          const conclusionTextWidth = RENDER_CONFIG.pptx.conclusion_text_width_inches * PX_PER_INCH;
          slide.addText(fitSingleLine(item, conclusionTextWidth, RENDER_CONFIG.legacy.conclusion_text_size * slideTheme.bodyScale, slideTheme.fontFamily), { x: isRtl(plan) ? RENDER_CONFIG.pptx.conclusion_text_x_rtl_inches : RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr / PX_PER_INCH, y: (y * PX_PER_INCH - RENDER_CONFIG.legacy.conclusion_text_size) / PX_PER_INCH, w: RENDER_CONFIG.pptx.conclusion_text_width_inches, h: (RENDER_CONFIG.legacy.conclusion_text_size * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.legacy.conclusion_text_size * PX_TO_PT * slideTheme.bodyScale, bold: true, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        });
      }
    }
    addPptxFooter(slide, pptx.ShapeType, deck, index, slideTheme, Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background)), plan);
  }
  return deduplicatePptxMedia(Buffer.from(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer));
}

function deduplicatePptxMedia(pptx: Buffer): Buffer {
  const entries = unzipSync(new Uint8Array(pptx));
  const canonicalByDigest = new Map<string, string>();
  const replacement = new Map<string, string>();
  for (const name of Object.keys(entries).sort()) {
    if (!name.startsWith('ppt/media/')) continue;
    const digest = createHash('sha256').update(entries[name]).digest('hex');
    const canonical = canonicalByDigest.get(digest);
    if (canonical === undefined) canonicalByDigest.set(digest, name);
    else replacement.set(name, canonical);
  }
  if (replacement.size === 0) return pptx;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const contentTypes = '[Content_Types].xml';
  const kept: Record<string, Uint8Array> = {};
  const order = Object.keys(entries).filter((name) => name !== contentTypes && !name.endsWith('/'));
  for (const name of entries[contentTypes] ? [contentTypes, ...order] : order) {
    if (replacement.has(name)) continue;
    const content = entries[name];
    if (!name.endsWith('.rels')) {
      kept[name] = content;
      continue;
    }
    let text = decoder.decode(content);
    for (const [duplicate, canonical] of replacement) text = text.replaceAll(`../media/${duplicate.slice('ppt/media/'.length)}`, `../media/${canonical.slice('ppt/media/'.length)}`);
    kept[name] = encoder.encode(text);
  }
  return Buffer.from(zipSync(kept, { level: 6 }));
}
