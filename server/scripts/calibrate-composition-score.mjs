#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const [inputArg, compareArg] = process.argv.slice(2);
if (!inputArg || inputArg.startsWith('-')) {
  console.error('Usage: node scripts/calibrate-composition-score.mjs REPORT_JSON [COMPARE_JSON]');
  process.exit(2);
}

const root = resolve(new URL('..', import.meta.url).pathname);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
}

const config = parse(await readFile(resolve(root, 'templates/render-config.yml'), 'utf8'));
const scoreConfig = config.composition_score ?? {};
const report = await readJson(inputArg);
const evaluation = report.compositionEvaluation;
if (!evaluation || !Array.isArray(evaluation.scoreBreakdown)) {
  throw new Error('The input must be a full render_report JSON response with compositionEvaluation.scoreBreakdown.');
}

const policy = {
  'column-balance': { kind: 'bonus', configKey: 'column_balance_weight', explanation: 'Up to the configured weight when sibling columns are equally filled.' },
  'heading-following-line': { kind: 'bonus', configKey: 'heading_following_line_bonus', explanation: 'A fixed bonus per heading that keeps a following line.' },
  'paragraph-fragmentation': { kind: 'penalty', configKey: 'paragraph_fragmentation_penalty', explanation: 'Penalty for obstacle-associated paragraph splits; natural transitions are reported separately.' },
  'orphan-lines': { kind: 'penalty', configKey: 'orphan_penalty', explanation: 'Penalty per isolated text fragment beside an obstacle.' },
  'insertion-spacing': { kind: 'penalty', configKeys: ['insertion_internal_spacing_penalty', 'insertion_external_spacing_penalty', 'insertion_cross_stream_spacing_penalty'], explanation: 'Aggregated penalty for internal, external and cross-stream insertion gaps.' },
  'insertion-text-continuity': { kind: 'target-fit', configKeys: ['insertion_text_continuity_reward', 'insertion_text_continuity_coverage_penalty', 'insertion_text_continuity_mass_penalty', 'insertion_text_continuity_cross_stream_penalty', 'insertion_text_continuity_edge_gap_penalty', 'insertion_text_continuity_visual_load_weight'], explanation: 'Bounded reward and measured penalties for text continuity around distributed insertions.' },
  'insertion-symmetry': { kind: 'target-fit', configKeys: ['insertion_symmetry_reward', 'insertion_symmetry_penalty', 'insertion_symmetry_tolerance_mm'], explanation: 'Bounded reward for symmetric measured text gaps; excess asymmetry keeps its configured penalty.' },
  'insertion-distribution': { kind: 'target-fit', configKeys: ['insertion_distribution_reward', 'insertion_distribution_penalty', 'insertion_distribution_tolerance_mm'], explanation: 'Bounded reward for even measured insertion gaps; excess dispersion keeps its configured penalty.' },
  'spacing-rhythm': { kind: 'target-fit', configKeys: ['spacing_profile_reward', 'spacing_profile_penalty', 'spacing_profile_tolerance_mm'], explanation: 'Bounded reward for gaps near the selected spacing-profile target; out-of-tolerance deviations keep their penalty.' },
  'content-spread': { kind: 'target-fit', configKeys: ['content_spread_reward', 'content_spread_penalty', 'content_spread_tolerance'], explanation: 'Bounded reward when insertions align with visual-load-weighted main-flow progress; excess gravity deviation keeps its penalty.' },
  'page-load-balance': { kind: 'target-fit', configKeys: ['page_load_balance_reward', 'page_load_balance_penalty', 'page_load_balance_tolerance'], explanation: 'Bounded reward for balanced insertion visual load across eligible pages; excess imbalance keeps its penalty.' },
  'main-page-occupancy-balance': { kind: 'target-fit', configKeys: ['main_page_occupancy_reward', 'main_page_occupancy_target', 'main_page_occupancy_tolerance'], explanation: 'Bounded reward for measured interior main-flow occupancy; terminal density is observational.' },
  'element-proximity': { kind: 'target-fit', configKeys: ['element_proximity_reward', 'element_proximity_penalty', 'spacing_profile_tolerance_mm'], explanation: 'Bounded neighboring-box gap reward with measured proximity penalties.' },
  'narrow-text-interval': { kind: 'penalty', configKey: 'narrow_text_interval_penalty', explanation: 'Penalty when an insertion leaves a text interval below the minimum width.' },
  'fit-content-envelope': { kind: 'penalty', configKey: 'fit_content_unused_penalty', explanation: 'Penalty for unused fit-content growth capacity.' },
  'header-spacing': { kind: 'penalty', configKey: 'header_content_gap_penalty', explanation: 'Penalty only when the header/content gap is below the minimum.' },
  'main-start-delay': { kind: 'penalty', configKey: 'main_start_delay_penalty', explanation: 'Penalty when an optional insertion delays the first main-flow line despite an available main slot.' },
  'footer-gap': { kind: 'penalty', configKey: 'footer_content_gap_penalty', explanation: 'Penalty only when content reaches the footer too closely.' },
  'glyph-overlap': { kind: 'penalty', configKey: 'glyph_overlap_penalty', explanation: 'Penalty proportional to overlapping glyph area.' },
  'sibling-column-imbalance': { kind: 'penalty', configKey: 'column_imbalance_penalty', explanation: 'Penalty for unequal sibling-column fill.' },
  'empty-regions': { kind: 'penalty', configKey: 'empty_region_penalty', explanation: 'Penalty for unexplained empty material regions.' },
  'list-continuity': { kind: 'penalty', configKey: 'list_split_penalty', explanation: 'Penalty for list continuity breaks.' },
  'table-continuity': { kind: 'penalty', configKey: 'table_split_penalty', explanation: 'Penalty for table continuity breaks.' },
  'tiny-fragments': { kind: 'penalty', configKey: 'tiny_fragment_penalty', explanation: 'Penalty for one-line edge fragments.' },
  contrast: { kind: 'penalty', configKey: 'contrast_penalty', explanation: 'Continuous penalty for measured contrast quality.' },
};

function componentReport(component) {
  const rule = policy[component.code];
  const configuredWeight = rule?.configKey ? scoreConfig[rule.configKey] : undefined;
  const configuredWeights = rule?.configKeys
    ? Object.fromEntries(rule.configKeys.map((key) => [key, scoreConfig[key]]).filter(([, value]) => value !== undefined))
    : undefined;
  return {
    code: component.code,
    value: component.value,
    points: component.points,
    ...(component.rewardCeiling === undefined ? {} : { rewardCeiling: component.rewardCeiling }),
    ...(component.rewardEvidence === undefined ? {} : { rewardEvidence: component.rewardEvidence }),
    ...(component.ceilingGap === undefined ? {} : { ceilingGap: component.ceilingGap }),
    kind: component.points > 0 ? 'bonus' : component.points < 0 ? 'penalty' : 'neutral',
    ...(rule ? { policy: rule.kind, explanation: rule.explanation } : {}),
    ...(configuredWeight === undefined ? {} : { configuredWeight }),
    ...(configuredWeights && Object.keys(configuredWeights).length > 0 ? { configuredWeights } : {}),
  };
}

function calibrate(result) {
  const components = result.compositionEvaluation.scoreBreakdown.map(componentReport);
  const positive = components.filter((component) => component.points > 0);
  const negative = components.filter((component) => component.points < 0);
  const neutral = components.filter((component) => component.points === 0);
  const positivePoints = positive.reduce((sum, component) => sum + component.points, 0);
  const negativePoints = negative.reduce((sum, component) => sum + component.points, 0);
  const base = Number(scoreConfig.base ?? 0);
  const reconstructedScore = base + positivePoints + negativePoints;
  return {
    status: result.compositionEvaluation.status,
    pages: result.compositionPlan?.pages?.length,
    score: result.compositionEvaluation.score,
    ...(result.compositionEvaluation.scoreUpperBound === undefined ? {} : { scoreUpperBound: result.compositionEvaluation.scoreUpperBound }),
    ...(result.compositionEvaluation.measuredRewardUpperBound === undefined ? {} : { measuredRewardUpperBound: result.compositionEvaluation.measuredRewardUpperBound }),
    boundsMeaning: 'Algebraic and evidence-based reward ceilings are not attainable optima or quality percentages. A ceiling gap is not a recoverable-points estimate.',
    baseScore: base,
    positivePoints,
    negativePoints,
    reconstructedScore,
    reconstructionDelta: result.compositionEvaluation.score - reconstructedScore,
    positiveShareOfBase: base === 0 ? 0 : positivePoints / base,
    penaltyShareOfBase: base === 0 ? 0 : Math.abs(negativePoints) / base,
    hasSpaceUtilizationBonus: components.some((component) => component.code === 'main-page-occupancy-balance'),
    hasMeasuredTargetFitRewards: components.some((component) => component.policy === 'target-fit'),
    policySummary: {
      bonuses: 'Column balance and heading-following-line add their configured positive points. Measured content gravity, insertion-gap fit, spacing-profile fit, page-load balance, and main-page occupancy can add bounded positive rewards.',
      cleanSpace: 'The occupancy reward applies only to measured main-flow line envelopes. Empty-region findings, white margins and unmeasured rendered ink do not earn a generic space-utilization bonus.',
      penalties: 'Out-of-tolerance deviations retain their configured penalties. Terminal density alone does not establish a defect. Penalties are additive and are not converted into a quality percentage.',
    },
    components,
    largestPenalties: [...negative].sort((left, right) => left.points - right.points).slice(0, 5),
    neutralComponents: neutral.map(({ code, value, policy, explanation }) => ({ code, value, ...(policy ? { policy } : {}), ...(explanation ? { explanation } : {}) })),
  };
}

const output = { report: calibrate(report) };
if (compareArg) {
  const comparison = await readJson(compareArg);
  output.compare = calibrate(comparison);
  output.delta = {
    score: output.report.score - output.compare.score,
    positivePoints: output.report.positivePoints - output.compare.positivePoints,
    negativePoints: output.report.negativePoints - output.compare.negativePoints,
  };
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
