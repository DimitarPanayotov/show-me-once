export const CONNECTOR_VERSION = '0.8.0';
export type McpAgent = 'codex' | 'claude-code' | 'cursor' | 'vscode' | 'other';
export function mcpInstallation(agent: McpAgent, appUrl: string) {
  const archive = `${new URL(appUrl).origin}/downloads/show-me-once-mcp-${CONNECTOR_VERSION}.tgz`;
  const configuration = { command: 'npx', args: ['-y', archive] };
  if (agent === 'cursor') return { label: 'Add to Cursor', link:
    `cursor://anysphere.cursor-deeplink/mcp/install?name=show_me_once&config=${encodeURIComponent(btoa(JSON.stringify(configuration)))}` };
  if (agent === 'vscode') return { label: 'Add to VS Code', link:
    `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'show_me_once', type: 'stdio', ...configuration }))}` };
  if (agent === 'claude-code') return { label: 'Copy setup command', command:
    `claude mcp add --scope user --transport stdio show_me_once -- npx -y "${archive}"` };
  if (agent === 'codex') return { label: 'Copy setup command', command:
    `codex mcp add show_me_once -- npx -y "${archive}"` };
  return { label: 'Copy MCP configuration', command: JSON.stringify({ mcpServers: { show_me_once: configuration } }, null, 2) };
}
