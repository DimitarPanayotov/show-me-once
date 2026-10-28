import { parseSkillPlan, readSkillStartUrl } from '@show-me-once/shared';
import { checkedStartUrl } from '@show-me-once/shared/start-page';
import { EXAMPLE_START_URL, exampleDraft } from './example-skill.ts';

export const skillBody = (markdown: string) => markdown.split('<!-- show-me-once-mcp -->')[0]!.replace(/\r\n/g, '\n').trim();

/** Recordings deliberately discard raw paths. Never invent a route from an ellipsis. */
export function resolveStartPage(markdown: string, supplied?: string): string {
  const plan = parseSkillPlan(markdown);
  if (plan.steps[0]?.kind !== 'navigation') throw new Error('The skill must begin with a navigation checkpoint.');
  const checkpoint = plan.steps[0].url;
  const example = JSON.stringify(plan) === JSON.stringify(parseSkillPlan(exampleDraft.markdown));
  const address = supplied ?? readSkillStartUrl(markdown) ?? (example ? EXAMPLE_START_URL : !checkpoint.includes('…') ? checkpoint : undefined);
  if (!address) throw new Error('Supply the public starting address in chat. The recording hides URL paths.');
  return checkedStartUrl(address, checkpoint);
}
