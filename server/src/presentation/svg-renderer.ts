import { assetDataUri, defaultRenderTheme } from '../brand/context.js';
import type { Slide, SlideDeck } from './contracts.js';
import type { RenderTheme } from '../core/model/render-theme.js';
import type { ResolvedSlidePlan } from '../core/model/resolved-slide-plan.js';
import { loadRenderFontSet, readableTextColor, renderSvgToPng } from '../rendering/primitives.js';
import { renderChart } from '../rendering/svg.js';
import { validateSlideContent } from './slide-validation.js';
import {
  RENDER_CONFIG,
  WIDTH,
  HEIGHT,
  fitMetricCard,
  fitSingleLine,
  fitTemplateText,
  fitText,
  getTitleSafeArea,
  isRtl,
  lockupGeometry,
  logicalBoxX,
  logicalTextAnchor,
  logicalTextX,
  slideLayout,
  assertTextFitsBox,
  assertTitleWithinSafeArea,
  text,
  templateFitTheme,
  titleTextLimit,
  subtitleTextLimit,
  textBoxBaseline,
} from './slide-layout.js';

export type { Slide, SlideDeck } from './contracts.js';



function frame(deck: SlideDeck, slide: Slide, index: number, theme: RenderTheme, assets: { logo?: string; logoMark?: string; background?: string; cover?: string }, plan?: ResolvedSlidePlan): string[] {
  const legacy = RENDER_CONFIG.legacy;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`, `<rect width="${WIDTH}" height="${HEIGHT}" fill="${theme.background}"/>`];
  const imageArea = plan?.slots.image;
  const imageClipId = `slide-image-slot-${index}`;
  const imageClip = imageArea ? ` clip-path="url(#${imageClipId})"` : '';
  const titleGraphic = slide.type === 'title' && Boolean(assets.cover);
  if (titleGraphic) {
    if (imageArea) parts.push(`<defs><clipPath id="${imageClipId}"><rect x="${imageArea.x}" y="${imageArea.y}" width="${imageArea.width}" height="${imageArea.height}"/></clipPath></defs>`);
    parts.push(`<image href="${assets.cover}" x="${imageArea?.x ?? 0}" y="${imageArea?.y ?? 0}" width="${imageArea?.width ?? WIDTH}" height="${imageArea?.height ?? HEIGHT}" preserveAspectRatio="xMidYMid slice"${imageClip}/>`);
    if (theme.imageScrim) {
      const area = theme.imageTextSafeArea;
      parts.push(`<rect x="${area.x * WIDTH}" y="${area.y * HEIGHT}" width="${area.width * WIDTH}" height="${area.height * HEIGHT}" fill="${theme.imageScrim.color}" opacity="${theme.imageScrim.opacity}" rx="${theme.radius}"/>`);
    }
  } else if (assets.background && theme.headerStyle === 'image-band') {
    const imageArea = plan?.slots.image;
    if (imageArea) parts.push(`<image href="${assets.background}" x="${imageArea.x}" y="${imageArea.y}" width="${imageArea.width}" height="${imageArea.height}" preserveAspectRatio="xMidYMid slice" opacity="${theme.backgroundImageOpacity}"/>`);
    else parts.push(`<image href="${assets.background}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice" opacity="${theme.backgroundImageOpacity}"/>`);
    if (theme.imageScrim) {
      const area = theme.imageTextSafeArea;
      parts.push(`<rect x="${area.x * WIDTH}" y="${area.y * HEIGHT}" width="${area.width * WIDTH}" height="${area.height * HEIGHT}" fill="${theme.imageScrim.color}" opacity="${theme.imageScrim.opacity}" rx="${theme.radius}"/>`);
    }
  }
  const band = theme.headerStyle === 'accent-band' ? theme.primary : theme.headerStyle === 'dark-band' ? theme.background : undefined;
  const layout = slideLayout(theme, plan);
  if (band && !titleGraphic) parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${layout.headerLineY}" fill="${band}"/>`);
  const lockup = lockupGeometry(slide, theme, deck.brand, plan);
  const { markX, markY, markW } = lockup;
  if (assets.logoMark) parts.push(`<image href="${assets.logoMark}" x="${markX}" y="${markY}" width="${markW}" height="${lockup.markH}" preserveAspectRatio="xMidYMid meet"/>`);
  else if (assets.logo) {
    const logoW = slide.type === 'title' ? theme.titleLogoWidthPx : legacy.regular_logo_width;
    const logoH = slide.type === 'title' ? theme.titleLogoHeightPx : legacy.regular_logo_height;
    const logoX = plan?.lockup.physicalSide === 'right' ? WIDTH - RENDER_CONFIG.spacing.margin - logoW : plan?.titleAlign === 'center' ? (WIDTH - logoW) / 2 : RENDER_CONFIG.spacing.margin;
    parts.push(`<image href="${assets.logo}" x="${logoX}" y="${markY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  const imageBand = theme.headerStyle === 'image-band' && Boolean(assets.background);
  const graphicText = imageBand ? theme.imageTextColor : '#ffffff';
  const bandText = band ? readableTextColor(band, theme, RENDER_CONFIG.typography.headerTitle, true) : imageBand ? graphicText : theme.foreground;
  if (assets.logoMark && slide.type === 'title' && deck.brand) {
    parts.push(text(lockup.nameX, lockup.nameY, deck.brand, lockup.nameSize, { color: band ? readableTextColor(band, theme, lockup.nameSize, true) : imageBand ? graphicText : theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: lockup.nameAnchor }));
  }
  if (slide.type !== 'title') {
    if (assets.logoMark && deck.brand) parts.push(text(lockup.nameX, lockup.nameY, deck.brand.toUpperCase(), lockup.nameSize, { color: bandText, weight: 700, family: theme.fontFamily, anchor: lockup.nameAnchor }));
    const headerTitleBox = plan?.sourceTemplate ? plan.slots.title : { x: RENDER_CONFIG.spacing.margin, y: layout.headerTitleY - legacy.header_title_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.header_title_box_height };
    const headerSubtitleBox = plan?.sourceTemplate ? plan.slots.subtitle : { x: RENDER_CONFIG.spacing.margin, y: layout.headerSubtitleY - legacy.header_subtitle_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.header_subtitle_box_height };
    const headerAnchor = plan?.titleAlign === 'right' || plan?.direction === 'rtl' ? 'end' : plan?.titleAlign === 'center' ? 'middle' : 'start';
    const headerX = headerAnchor === 'end' ? headerTitleBox.x + headerTitleBox.width : headerAnchor === 'middle' ? headerTitleBox.x + headerTitleBox.width / 2 : headerTitleBox.x;
    const headerTitleSize = Math.round(RENDER_CONFIG.typography.headerTitle * theme.headingScale);
    const headerTitleFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, headerTitleSize, Math.max(legacy.header_title_min_chars, Math.floor(headerTitleBox.width / (headerTitleSize * RENDER_CONFIG.text.headingGlyphWidth))), plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.headerMaxLines, templateFitTheme(theme, plan?.titleConstraints.overflow));
    if (headerTitleFit.overflow) throw new Error(`Slide heading does not fit within its template slot: ${slide.title}`);
    const headerTitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerTitleBox, headerTitleFit.size) : layout.headerTitleY;
    assertTextFitsBox('Slide heading', headerTitleFit, headerTitleBox, headerTitleBaseline, theme.headingFontFamily);
    parts.push(headerTitleFit.lines.map((line, lineIndex) => text(headerX, headerTitleBaseline + lineIndex * headerTitleFit.lineHeight, line, headerTitleFit.size, { color: bandText, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: headerAnchor })).join(''));
    if (slide.subtitle) {
      const subtitleX = headerAnchor === 'end' ? headerSubtitleBox.x + headerSubtitleBox.width : headerAnchor === 'middle' ? headerSubtitleBox.x + headerSubtitleBox.width / 2 : headerSubtitleBox.x;
      const headerSubtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale, Math.max(legacy.header_subtitle_min_chars, Math.floor(headerSubtitleBox.width / (RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale * RENDER_CONFIG.text.bodyGlyphWidth))), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.headerMaxLines, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
      if (headerSubtitleFit.overflow) throw new Error(`Slide subtitle does not fit within its template slot: ${slide.subtitle}`);
      const headerSubtitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerSubtitleBox, headerSubtitleFit.size) : layout.headerSubtitleY;
      assertTextFitsBox('Slide subtitle', headerSubtitleFit, headerSubtitleBox, headerSubtitleBaseline, theme.fontFamily);
      parts.push(headerSubtitleFit.lines.map((line, lineIndex) => text(subtitleX, headerSubtitleBaseline + lineIndex * headerSubtitleFit.lineHeight, line, headerSubtitleFit.size, { color: band ? readableTextColor(band, theme, headerSubtitleFit.size, false) : imageBand ? graphicText : theme.muted, family: theme.fontFamily, anchor: headerAnchor })).join(''));
    }
    const headerBox = plan?.slots.header ?? { x: RENDER_CONFIG.spacing.margin, y: 0, width: RENDER_CONFIG.spacing.contentWidth, height: layout.headerLineY };
    if (!band) parts.push(`<line x1="${headerBox.x}" y1="${layout.headerLineY}" x2="${headerBox.x + headerBox.width}" y2="${layout.headerLineY}" stroke="${theme.line}" stroke-width="2"/>`);
  }
  const footerBox = plan?.slots.footer ?? { x: RENDER_CONFIG.spacing.margin, y: RENDER_CONFIG.spacing.footerY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.spacing.footerHeight };
  const footerY = footerBox.y;
  const footerTextY = textBoxBaseline(footerBox, RENDER_CONFIG.typography.footer);
  const footerOnGraphic = imageBand || titleGraphic;
  const footerLineColor = footerOnGraphic ? theme.imageTextColor : theme.line;
  const footerTextColor = footerOnGraphic ? theme.titleSubtitleColor : theme.muted;
  parts.push(`<line x1="${footerBox.x}" y1="${footerY}" x2="${footerBox.x + footerBox.width}" y2="${footerY}" stroke="${footerLineColor}" stroke-width="2" opacity="${footerOnGraphic ? 0.65 : 1}"/>`);
  const footer = deck.slideFooters?.[index] ?? deck.footer;
  if (footer) parts.push(text(logicalTextX(footerBox.x, footerBox.width, plan, 0), footerTextY, fitSingleLine(footer, footerBox.width, RENDER_CONFIG.typography.footer, theme.fontFamily), RENDER_CONFIG.typography.footer, { color: footerTextColor, anchor: logicalTextAnchor(plan), family: theme.fontFamily }));
  parts.push(text(footerBox.x + footerBox.width, footerTextY, `${index + 1} / ${deck.slides.length}`, RENDER_CONFIG.typography.footer, { color: footerTextColor, anchor: 'end', family: theme.fontFamily }));
  return parts;
}

async function chartImage(slide: Extract<Slide, { type: 'chart' }>, theme: RenderTheme, width = RENDER_CONFIG.chart.width, height = RENDER_CONFIG.chart.height): Promise<string> {
  const svg = renderChart(slide.chart.type, {
    ...slide.chart,
    width,
    height,
    theme,
    data: slide.chart.data.map((datum, index) => ({ ...datum, color: datum.color ?? theme.palette[index % theme.palette.length] })),
  });
  const png = await renderSvgToPng(svg, width, await loadRenderFontSet(theme));
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function renderSlideSvg(deck: SlideDeck, slide: Slide, index: number, theme = defaultRenderTheme()): Promise<string> {
  validateSlideContent(slide);
  const legacy = RENDER_CONFIG.legacy;
  const plan = deck.slidePlans?.[index];
  const titleAlign = plan?.titleAlign ?? theme.titleAlign;
  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoMarkPath = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoMarkPath : theme.logoMarkPath;
  const [logo, logoMark, background, cover] = await Promise.all([assetDataUri(logoPath), assetDataUri(logoMarkPath), assetDataUri(theme.backgroundImagePath), assetDataUri(theme.coverImagePath)]);
  const parts = frame(deck, slide, index, theme, { logo, logoMark, background, cover }, plan);
  const layout = slideLayout(theme, plan);
  const titleOnGraphic = theme.headerStyle === 'dark-band' || Boolean(cover) || (theme.headerStyle === 'image-band' && Boolean(background));
  const titleColor = titleOnGraphic ? theme.imageTextColor : theme.foreground;
  const graphicContentColor = titleOnGraphic ? theme.imageTextColor : theme.foreground;
  const titleAnchor = titleAlign === 'center' ? 'middle' : titleAlign === 'right' ? 'end' : 'start';
  const safeArea = getTitleSafeArea(theme, plan);
  const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');
  const titleBox = typedSource && plan?.slots.title ? { x: plan.slots.title.x / WIDTH, y: plan.slots.title.y / HEIGHT, width: plan.slots.title.width / WIDTH, height: plan.slots.title.height / HEIGHT } : safeArea;
  const titleX = titleAlign === 'center' ? (titleBox.x + titleBox.width / 2) * WIDTH : titleAlign === 'right' ? (titleBox.x + titleBox.width) * WIDTH : titleBox.x * WIDTH;
  const eyebrowBox = typedSource && plan?.slots.eyebrow ? { x: plan.slots.eyebrow.x / WIDTH, y: plan.slots.eyebrow.y / HEIGHT, width: plan.slots.eyebrow.width / WIDTH, height: plan.slots.eyebrow.height / HEIGHT } : titleBox;
  const eyebrowX = titleAlign === 'center' ? (eyebrowBox.x + eyebrowBox.width / 2) * WIDTH : titleAlign === 'right' ? (eyebrowBox.x + eyebrowBox.width) * WIDTH : eyebrowBox.x * WIDTH;
  const eyebrowY = plan?.titleLayout.eyebrowY ?? RENDER_CONFIG.fallbacks.title_eyebrow_y;
  const titleY = plan?.titleLayout.titleBaselineY ?? RENDER_CONFIG.legacy.title_baseline_y;
  const graphicTitle = Boolean(cover) || (theme.headerStyle === 'image-band' && Boolean(background));
  const titleMaxChars = titleTextLimit(theme, titleBox, RENDER_CONFIG.typography.title, RENDER_CONFIG.legacy.title_max_chars, graphicTitle);
  if (slide.type === 'title') {
    const lockupName = lockupGeometry(slide, theme, deck.brand, plan);
    if (deck.brand && plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand], size: lockupName.nameSize, lineHeight: lockupName.nameSize, overflow: false }, plan.lockup.name, lockupName.nameY, theme.headingFontFamily);
    if (slide.eyebrow || deck.brand) {
      const eyebrowFit = fitText(slide.eyebrow ?? deck.brand?.toUpperCase() ?? '', RENDER_CONFIG.typography.eyebrow, RENDER_CONFIG.legacy.title_eyebrow_max_chars, plan?.eyebrowConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.eyebrowConstraints.overflow), theme.minBodyPt);
      if (eyebrowFit.overflow) throw new Error(`Slide eyebrow does not fit within the template slot: ${slide.eyebrow ?? deck.brand}`);
      assertTextFitsBox('Slide eyebrow', eyebrowFit, { x: eyebrowBox.x * WIDTH, y: eyebrowBox.y * HEIGHT, width: eyebrowBox.width * WIDTH, height: eyebrowBox.height * HEIGHT }, eyebrowY, theme.fontFamily);
      parts.push(eyebrowFit.lines.map((line, lineIndex) => text(eyebrowX, eyebrowY + lineIndex * eyebrowFit.lineHeight, line, eyebrowFit.size, { color: titleOnGraphic ? theme.imageTextColor : theme.primary, weight: 700, anchor: titleAnchor, family: theme.fontFamily })).join(''));
    }
    const titleFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, RENDER_CONFIG.typography.title, titleMaxChars, plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.titleMaxLines, templateFitTheme(theme, plan?.titleConstraints.overflow));
    if (titleFit.overflow) throw new Error(`Slide title does not fit within the safe title area: ${slide.title}`);
    assertTextFitsBox('Slide title', titleFit, { x: titleBox.x * WIDTH, y: titleBox.y * HEIGHT, width: titleBox.width * WIDTH, height: titleBox.height * HEIGHT }, titleY, theme.headingFontFamily);
    parts.push(titleFit.lines.map((line, lineIndex) => text(titleX, titleY + lineIndex * titleFit.lineHeight, line, titleFit.size, { color: titleColor, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: titleAnchor })).join(''));
    if (slide.subtitle) {
      const subtitleY = plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap);
      const subtitleBox = typedSource && plan?.slots.subtitle ? { x: plan.slots.subtitle.x / WIDTH, y: plan.slots.subtitle.y / HEIGHT, width: plan.slots.subtitle.width / WIDTH, height: plan.slots.subtitle.height / HEIGHT } : safeArea;
      const subtitleX = titleAlign === 'center' ? (subtitleBox.x + subtitleBox.width / 2) * WIDTH : titleAlign === 'right' ? (subtitleBox.x + subtitleBox.width) * WIDTH : subtitleBox.x * WIDTH;
      const subtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.subtitle * theme.bodyScale, subtitleTextLimit(theme, subtitleBox, RENDER_CONFIG.typography.subtitle * theme.bodyScale, RENDER_CONFIG.legacy.subtitle_max_chars, graphicTitle), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.subtitleMaxLines, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
      if (subtitleFit.overflow) throw new Error(`Slide subtitle does not fit within the safe title area: ${slide.subtitle}`);
      assertTextFitsBox('Slide subtitle', subtitleFit, { x: subtitleBox.x * WIDTH, y: subtitleBox.y * HEIGHT, width: subtitleBox.width * WIDTH, height: subtitleBox.height * HEIGHT }, subtitleY, theme.fontFamily);
      assertTitleWithinSafeArea(theme, titleFit, subtitleFit, plan);
      parts.push(subtitleFit.lines.map((line, lineIndex) => text(subtitleX, subtitleY + lineIndex * subtitleFit.lineHeight, line, subtitleFit.size, { color: titleOnGraphic ? theme.imageTextColor : theme.muted, family: theme.fontFamily, anchor: titleAnchor })).join(''));
    } else assertTitleWithinSafeArea(theme, titleFit, undefined, plan);
  } else if (slide.type === 'metrics') {
    const brandMetrics = Boolean(plan?.slots['metric-1']);
    if (plan?.sourceTemplate?.archetype === 'metrics' && slide.metrics.length !== 3) throw new Error(`Template '${plan.templateRef}' requires exactly three metrics.`);
    const columns = Math.min(3, slide.metrics.length);
    const rows = Math.ceil(slide.metrics.length / columns);
    const gap = RENDER_CONFIG.spacing.cardGap;
    const cardWidth = (RENDER_CONFIG.spacing.contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = Math.min(RENDER_CONFIG.metrics.maxHeight, (RENDER_CONFIG.metrics.usableHeight - gap * (rows - 1)) / rows);
    slide.metrics.forEach((metric, metricIndex) => {
      const col = metricIndex % columns;
      const row = Math.floor(metricIndex / columns);
      const sourceBox = brandMetrics ? plan?.slots[`metric-${metricIndex + 1}`] : undefined;
      if (brandMetrics && !sourceBox) throw new Error(`Template '${plan?.templateRef ?? 'resolved slide'}' is missing metric-${metricIndex + 1}.`);
      const x = sourceBox?.x ?? logicalBoxX(RENDER_CONFIG.spacing.margin + col * (cardWidth + gap), cardWidth, plan);
      const y = sourceBox?.y ?? layout.contentTop + row * (cardHeight + gap);
      const width = sourceBox?.width ?? cardWidth;
      const height = sourceBox?.height ?? cardHeight;
      const metricFit = fitMetricCard(metric, { x, y, width, height }, theme);
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.line}" stroke-width="2"/>`);
      const textX = logicalTextX(x, width, plan, RENDER_CONFIG.spacing.cardPaddingX);
      const anchor = logicalTextAnchor(plan);
      const labelY = y + height * RENDER_CONFIG.metrics.labelBaseline;
      const valueY = y + height * RENDER_CONFIG.metrics.valueBaseline;
      const deltaY = y + height * RENDER_CONFIG.metrics.deltaBaseline;
      parts.push(metricFit.label.lines.map((line, lineIndex) => text(textX, labelY + lineIndex * metricFit.label.lineHeight, line, metricFit.label.size, { color: theme.muted, weight: 700, family: theme.fontFamily, anchor })).join(''));
      parts.push(metricFit.value.lines.map((line, lineIndex) => text(textX, valueY + lineIndex * metricFit.value.lineHeight, line, metricFit.value.size, { color: theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor })).join(''));
      if (metricFit.delta) parts.push(metricFit.delta.lines.map((line, lineIndex) => text(textX, deltaY + lineIndex * metricFit.delta!.lineHeight, line, metricFit.delta!.size, { color: metric.trend === 'down' ? theme.danger : metric.trend === 'up' ? theme.success : theme.muted, weight: 700, family: theme.fontFamily, anchor })).join(''));
      if (metricFit.note) parts.push(metricFit.note.lines.map((line, lineIndex) => text(textX, y + height - RENDER_CONFIG.metrics.noteBottom + lineIndex * metricFit.note!.lineHeight, line, metricFit.note!.size, { color: theme.muted, family: theme.fontFamily, anchor })).join(''));
    });
    const bodyBox = brandMetrics ? plan?.slots.body : undefined;
    if (slide.body) {
      const box = bodyBox ?? { x: RENDER_CONFIG.spacing.margin, y: layout.contentTop + RENDER_CONFIG.fallbacks.metrics_body_y_offset, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.metrics_body_height };
      const body = fitTemplateText('Metrics body', slide.body, box, Math.round(RENDER_CONFIG.typography.body * theme.bodyScale), plan?.slotRules.body?.maxLines ?? 3, plan?.slotRules.body?.overflow, plan?.slotRules.body?.verticalAlign, theme, theme.fontFamily);
      const bodyX = logicalTextX(box.x, box.width, plan, 0);
      parts.push(body.fit.lines.map((line, lineIndex) => text(bodyX, body.baseline + lineIndex * body.fit.lineHeight, line, body.fit.size, { color: theme.foreground, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    }
    if (slide.callout) {
      const calloutBox = brandMetrics ? plan?.slots.callout : undefined;
      const calloutX = calloutBox ? calloutBox.x : RENDER_CONFIG.spacing.margin;
      const calloutY = calloutBox?.y ?? layout.contentTop + RENDER_CONFIG.fallbacks.metrics_callout_y_offset;
      const calloutWidth = calloutBox?.width ?? RENDER_CONFIG.spacing.contentWidth;
      const calloutHeight = calloutBox?.height ?? RENDER_CONFIG.metrics.calloutHeight;
      parts.push(`<rect x="${calloutX}" y="${calloutY}" width="${calloutWidth}" height="${calloutHeight}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.primary}" stroke-width="2"/>`);
      const box = { x: calloutX + RENDER_CONFIG.metrics.calloutPaddingX, y: calloutY + RENDER_CONFIG.metrics.calloutPaddingY, width: calloutWidth - RENDER_CONFIG.metrics.calloutPaddingX * 2, height: calloutHeight - RENDER_CONFIG.metrics.calloutPaddingY * 2 };
      const callout = fitTemplateText('Metrics callout', slide.callout, box, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules.callout?.maxLines ?? 2, plan?.slotRules.callout?.overflow, plan?.slotRules.callout?.verticalAlign, theme, theme.fontFamily);
      const calloutXText = logicalTextX(calloutX, calloutWidth, plan, RENDER_CONFIG.metrics.calloutPaddingX);
      parts.push(callout.fit.lines.map((line, lineIndex) => text(calloutXText, callout.baseline + lineIndex * callout.fit.lineHeight, line, callout.fit.size, { color: theme.foreground, weight: 700, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    }
  } else if (slide.type === 'columns') {
    const fallbackBoxes = [
      { x: RENDER_CONFIG.spacing.margin, y: layout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: layout.contentBottom - layout.contentTop - legacy.columns_fallback_height_padding },
      { x: RENDER_CONFIG.spacing.margin + legacy.columns_fallback_width + legacy.columns_fallback_x_gap, y: layout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: layout.contentBottom - layout.contentTop - legacy.columns_fallback_height_padding },
    ];
    slide.columns.forEach((column, columnIndex) => {
      const box = plan?.slots[columnIndex === 0 ? 'left' : 'right'] ?? fallbackBoxes[columnIndex]!;
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.line}" stroke-width="2"/>`);
      const inner = { x: box.x + RENDER_CONFIG.spacing.columnPadding, y: box.y + RENDER_CONFIG.fallbacks.columns_inner_padding_y, width: box.width - RENDER_CONFIG.spacing.columnPadding * 2, height: box.height - RENDER_CONFIG.fallbacks.columns_inner_padding_y * 2 };
      const anchor = logicalTextAnchor(plan);
      const heading = column.heading ?? `Column ${columnIndex + 1}`;
      const headingFit = fitTemplateText(`Column ${columnIndex + 1} heading`, heading, { ...inner, height: legacy.columns_heading_height }, Math.round(RENDER_CONFIG.fallbacks.columns_heading_size * theme.headingScale), 2, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.overflow, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.verticalAlign, theme, theme.headingFontFamily);
      const headingX = logicalTextX(box.x, box.width, plan, RENDER_CONFIG.spacing.columnPadding);
      parts.push(headingFit.fit.lines.map((line, lineIndex) => text(headingX, headingFit.baseline + lineIndex * headingFit.fit.lineHeight, line, headingFit.fit.size, { color: theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor })).join(''));
      const bodyValue = [column.body, ...(column.highlights ?? []).map((item) => `• ${item}`)].join('\n');
      const bodyBox = { x: inner.x, y: box.y + legacy.columns_body_top, width: inner.width, height: box.height - legacy.columns_body_bottom_padding };
      const bodyFit = fitTemplateText(`Column ${columnIndex + 1} body`, bodyValue, bodyBox, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.maxLines ?? 12, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.overflow, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.verticalAlign, theme, theme.fontFamily);
      parts.push(bodyFit.fit.lines.map((line, lineIndex) => text(logicalTextX(bodyBox.x, bodyBox.width, plan, 0), bodyFit.baseline + lineIndex * bodyFit.fit.lineHeight, line, bodyFit.fit.size, { color: theme.foreground, family: theme.fontFamily, anchor })).join(''));
    });
  } else if (slide.type === 'chart') {
  parts.push(`<image href="${await chartImage(slide, theme, layout.chart.width, layout.chart.height)}" x="${layout.chart.x}" y="${layout.chart.y}" width="${layout.chart.width}" height="${layout.chart.height}" preserveAspectRatio="xMidYMid meet"/>`);
  } else if (slide.type === 'table') {
    const columns = slide.head.length;
    const colWidth = RENDER_CONFIG.spacing.contentWidth / columns;
    const rows = slide.body.slice(0, 10);
    const rowHeight = Math.min(legacy.table_row_max_height, layout.table.height / (rows.length + 1));
    slide.head.forEach((cell, col) => {
      const x = logicalBoxX(RENDER_CONFIG.spacing.margin + col * colWidth, colWidth, plan);
      parts.push(`<rect x="${x}" y="${layout.table.y}" width="${colWidth}" height="${rowHeight}" fill="${theme.primary}"/>`);
      parts.push(text(logicalTextX(x, colWidth, plan), layout.table.y + rowHeight * legacy.table_row_text_ratio, fitSingleLine(cell, colWidth - RENDER_CONFIG.spacing.cardPaddingX, legacy.table_text_size, theme.fontFamily), legacy.table_text_size, { color: readableTextColor(theme.primary, theme, legacy.table_text_size, true), weight: 700, anchor: logicalTextAnchor(plan) }));
    });
    rows.forEach((row, rowIndex) => row.forEach((cell, col) => {
      const x = logicalBoxX(RENDER_CONFIG.spacing.margin + col * colWidth, colWidth, plan);
      const y = layout.table.y + (rowIndex + 1) * rowHeight;
      parts.push(`<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="${rowIndex % 2 ? theme.soft : theme.background}" stroke="${theme.line}" stroke-width="1"/>`);
      const cellSize = Math.round(legacy.table_body_text_size * theme.bodyScale);
      parts.push(text(logicalTextX(x, colWidth, plan), y + rowHeight * legacy.table_row_text_ratio, fitSingleLine(String(cell).slice(0, legacy.table_cell_max_chars), colWidth - RENDER_CONFIG.spacing.cardPaddingX, cellSize, theme.fontFamily), cellSize, { color: theme.foreground, anchor: logicalTextAnchor(plan) }));
    }));
  } else if (slide.type === 'narrative') {
    const narrativeBox = plan?.slots.narrative ?? { x: RENDER_CONFIG.spacing.margin, y: layout.narrativeY - RENDER_CONFIG.fallbacks.narrative_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.narrative_fallback_height };
    const narrativeFit = fitTemplateText('Narrative body', slide.body, narrativeBox, Math.round(RENDER_CONFIG.typography.narrative * theme.bodyScale), plan?.slotRules.narrative?.maxLines ?? 5, plan?.slotRules.narrative?.overflow, plan?.slotRules.narrative?.verticalAlign, theme, theme.fontFamily);
    parts.push(narrativeFit.fit.lines.map((line, lineIndex) => text(logicalTextX(narrativeBox.x, narrativeBox.width, plan, 0), narrativeFit.baseline + lineIndex * narrativeFit.fit.lineHeight, line, narrativeFit.fit.size, { color: graphicContentColor, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    (slide.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => {
      const highlightBox = plan?.slots[`narrative-highlight-${itemIndex + 1}`] ?? { x: legacy.narrative_highlight_x, y: legacy.narrative_highlight_y + itemIndex * legacy.narrative_highlight_step, width: legacy.narrative_highlight_width, height: legacy.narrative_highlight_height };
      const fit = fitTemplateText(`Narrative highlight ${itemIndex + 1}`, item, highlightBox, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.maxLines ?? 1, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.overflow, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.verticalAlign, theme, theme.fontFamily);
      const bulletX = isRtl(plan) ? highlightBox.x + highlightBox.width + RENDER_CONFIG.spacing.columnPadding - RENDER_CONFIG.fallbacks.bullet_x_nudge : highlightBox.x - RENDER_CONFIG.spacing.columnPadding + RENDER_CONFIG.fallbacks.bullet_x_nudge;
      parts.push(`<circle cx="${bulletX}" cy="${fit.baseline - RENDER_CONFIG.spacing.cardPaddingY / RENDER_CONFIG.fallbacks.bullet_baseline_divisor}" r="${RENDER_CONFIG.shapes.bulletRadius}" fill="${titleOnGraphic ? theme.imageTextColor : theme.primary}"/>`);
      parts.push(fit.fit.lines.map((line, lineIndex) => text(logicalTextX(highlightBox.x, highlightBox.width, plan, 0), fit.baseline + lineIndex * fit.fit.lineHeight, line, fit.fit.size, { color: graphicContentColor, weight: 700, anchor: logicalTextAnchor(plan) })).join(''));
    });
  } else if (slide.type === 'conclusions') {
    const conclusionsBox = plan?.slots.conclusions ?? { x: RENDER_CONFIG.spacing.margin, y: layout.conclusionsY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.conclusions_height };
    slide.items.slice(0, 7).forEach((item, itemIndex) => {
      const rowHeight = conclusionsBox.height / Math.max(slide.items.length, 1);
      const y = conclusionsBox.y + rowHeight * (itemIndex + 0.5);
      const iconX = isRtl(plan) ? conclusionsBox.x + conclusionsBox.width - RENDER_CONFIG.shapes.conclusionIcon : conclusionsBox.x;
      parts.push(`<rect x="${iconX}" y="${y - RENDER_CONFIG.legacy.conclusion_icon_y_adjustment}" width="${RENDER_CONFIG.shapes.conclusionIcon}" height="${RENDER_CONFIG.shapes.conclusionIcon}" rx="${RENDER_CONFIG.shapes.conclusionIconRadius}" fill="${theme.palette[itemIndex % theme.palette.length]}"/>`);
      parts.push(text(iconX + RENDER_CONFIG.shapes.conclusionIcon / 2, y - RENDER_CONFIG.legacy.conclusion_number_y_adjustment, itemIndex + 1, RENDER_CONFIG.legacy.conclusion_number_size, { color: theme.background, weight: 700, anchor: 'middle' }));
      const conclusionTextX = isRtl(plan) ? conclusionsBox.x : iconX + RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr - RENDER_CONFIG.legacy.conclusion_icon_x_ltr;
      const conclusionTextWidth = conclusionsBox.width - RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr + RENDER_CONFIG.legacy.conclusion_icon_x_ltr;
      const conclusionSize = Math.round(RENDER_CONFIG.legacy.conclusion_text_size * theme.bodyScale);
      parts.push(text(logicalTextX(conclusionTextX, conclusionTextWidth, plan, 0), y, fitSingleLine(item, conclusionTextWidth, conclusionSize, theme.fontFamily), conclusionSize, { color: graphicContentColor, weight: 600, anchor: logicalTextAnchor(plan), family: theme.fontFamily }));
    });
  }
  parts.push('</svg>');
  return parts.join('');
}
