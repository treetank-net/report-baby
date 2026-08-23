import { z } from 'zod';

const pathSchema = z.string().min(1);
const formatSchema = z.enum(['pdf', 'png', 'pptx']);

const outputSchema = z.object({
  pdf: pathSchema.optional(),
  png: z.array(pathSchema).optional(),
  pptx: pathSchema.optional(),
}).strict();

const diagnosticsSchema = z.object({
  brandRef: z.string().optional(),
  profile: z.string().optional(),
  templateRef: z.string().optional(),
  surface: z.string().optional(),
  appliedOverrides: z.array(z.string()),
  warnings: z.array(z.string()),
}).passthrough();

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
}).strict();

const themeSchema = z.object({
  background: z.string(),
  foreground: z.string(),
  primary: z.string(),
  secondary: z.string(),
  muted: z.string(),
  line: z.string(),
  surface: z.string(),
  success: z.string(),
  danger: z.string(),
  warning: z.string(),
  imageTextColor: z.string(),
  imageTextSafeArea: boxSchema,
  imageScrim: z.object({ color: z.string(), opacity: z.number() }).optional(),
  fontFamily: z.string(),
  headingFontFamily: z.string(),
  hasFontAssets: z.boolean(),
  fitStrategy: z.string(),
  pptxHeadingScale: z.number(),
  minBodyPt: z.number(),
  minHeadingPt: z.number(),
  headerStyle: z.string(),
  reportHeaderStyle: z.string(),
  titleAlign: z.string(),
  titleCase: z.string(),
  titleColor: z.string(),
  titleAccentColor: z.string(),
  titleSubtitleColor: z.string(),
  titleLogoWidthPx: z.number(),
  titleLogoHeightPx: z.number(),
  coverBackground: z.string().optional(),
  radius: z.number(),
  logoVariant: z.string(),
  hasLogo: z.boolean(),
  hasLogoMark: z.boolean(),
  lockupModel: z.object({
    canvasWidthPx: z.number(),
    canvasHeightPx: z.number(),
    pixelsPerInch: z.number(),
    markWidthPx: z.number(),
    titleMarkWidthPx: z.number(),
    gapPx: z.number(),
  }).strict(),
  hasBackgroundImage: z.boolean(),
  hasCoverImage: z.boolean(),
  hasReportHeaderImage: z.boolean(),
}).strict();

const constraintsSchema = z.object({
  maxLines: z.number(),
  overflow: z.enum(['reject', 'shrink-to-fit']).optional(),
}).strict();

const slotRuleSchema = z.object({
  maxLines: z.number().optional(),
  overflow: z.enum(['reject', 'shrink-to-fit']).optional(),
}).strict();

const slidePlanSchema = z.object({
  templateRef: z.string(),
  direction: z.string(),
  titleAlign: z.string(),
  titleLayout: z.object({
    eyebrowY: z.number(),
    titleBaselineY: z.number(),
    subtitleBaselineY: z.number(),
  }).strict(),
  titleConstraints: constraintsSchema,
  subtitleConstraints: constraintsSchema,
  slotRules: z.record(slotRuleSchema),
  sourceTemplate: z.object({
    id: z.string(),
    surface: z.string(),
    archetype: z.string().optional(),
  }).strict().optional(),
  slotBoxes: z.record(boxSchema),
  slots: z.record(z.string()),
  lockup: z.object({
    spacing: z.string(),
    physicalSide: z.enum(['left', 'right']),
  }).strict(),
}).strict();

const slideLayoutSchema = z.object({
  titleLines: z.number(),
  subtitleLines: z.number(),
}).strict();

const reportPayloadSchema = z.object({
  outputs: outputSchema,
  diagnostics: diagnosticsSchema,
  theme: themeSchema,
}).strict();

const deckPayloadSchema = z.object({
  outputs: outputSchema,
  diagnostics: diagnosticsSchema,
  theme: themeSchema,
  slideDiagnostics: z.array(diagnosticsSchema).optional(),
  slideThemes: z.array(themeSchema.nullable()).optional(),
  slidePlans: z.array(slidePlanSchema.nullable()).optional(),
  slideLayout: z.array(slideLayoutSchema),
}).strict();

const showcaseReportSchema = reportPayloadSchema.extend({
  id: z.string().min(1),
  profile: z.string().optional(),
});

const showcaseDeckSchema = deckPayloadSchema.extend({
  id: z.string().min(1),
});

const showcasePayloadSchema = z.object({
  outputs: z.object({
    reports: z.array(showcaseReportSchema),
    decks: z.array(showcaseDeckSchema),
  }).strict(),
  showcase: z.object({
    reports: z.number().int().nonnegative(),
    decks: z.number().int().nonnegative(),
  }).passthrough(),
}).strict();

const manifestBaseSchema = z.object({
  schema_version: z.literal(1),
  brand: z.string().min(1),
  brandRoot: z.string().min(1),
  input: z.string().min(1).optional(),
  formats: z.array(formatSchema),
});

const preparedAssetSourceSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  px: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const preparedAssetDerivativeSchema = z.object({
  role: z.string().min(1),
  path: z.string().min(1),
  px: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  dpi: z.number().positive(),
  crop: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  bytes: z.number().int().nonnegative(),
}).strict();

const preparedAssetEntrySchema = z.object({
  kind: z.literal('prepared-assets'),
  source: preparedAssetSourceSchema,
  derivatives: z.array(preparedAssetDerivativeSchema),
  generatedAt: z.string().min(1),
  toolVersion: z.string().min(1),
}).strict();

export const renderManifestSchema = z.discriminatedUnion('kind', [
  manifestBaseSchema.extend({ kind: z.literal('report') }).merge(reportPayloadSchema),
  manifestBaseSchema.extend({ kind: z.literal('deck') }).merge(deckPayloadSchema),
  manifestBaseSchema.extend({ kind: z.literal('showcase') }).merge(showcasePayloadSchema),
  z.object({ schema_version: z.literal(1), kind: z.literal('prepared-assets'), assets: z.array(preparedAssetEntrySchema) }).strict(),
]);

export type RenderManifest = z.infer<typeof renderManifestSchema>;

export function validateRenderManifest(value: unknown): RenderManifest {
  return renderManifestSchema.parse(value);
}
