import { getRecipeRunsDir } from '../../infrastructure/config.js';
import { argumentsDifferNotice, captureReceipt, captureToolCall, resolveSpilledResponse, sessionToolResultsDir } from '../../recipes/run.js';

interface PostToolUseInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  transcript_path?: unknown;
  session_id?: unknown;
}

async function readStdin(): Promise<string> {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) buffer += chunk;
  return buffer;
}

function hookOutput(fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', ...fields } })}\n`);
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as PostToolUseInput;
  if (input.hook_event_name !== 'PostToolUse' || typeof input.tool_name !== 'string') return;
  const outcome = captureToolCall(getRecipeRunsDir(), { tool_name: input.tool_name, tool_input: input.tool_input, tool_response: resolveSpilledResponse(input.tool_response, sessionToolResultsDir(input.transcript_path, input.session_id)) });
  if (outcome.kind === 'captured') hookOutput({ updatedToolOutput: [{ type: 'text', text: captureReceipt(outcome) }] });
  if (outcome.kind === 'arguments-differ') hookOutput({ additionalContext: argumentsDifferNotice(outcome) });
}

main().catch((error: unknown) => {
  process.stderr.write(`report-baby recipe capture hook: ${error instanceof Error ? error.message : String(error)}\n`);
});
