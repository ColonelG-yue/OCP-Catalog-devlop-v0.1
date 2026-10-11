/** Read-only MCP capability probe. No token is printed or persisted. */
const SERVICES = {
  luckin: { url: 'https://gwmcp.lkcoffee.com/order/user/mcp', env: 'LUCKIN_MCP_TOKEN' },
  mcdonalds: { url: 'https://mcp.mcd.cn', env: 'MCD_MCP_TOKEN' },
} as const;

async function rpc(url: string, token: string, method: string, session?: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method,
      ...(method === 'initialize' ? { params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentmall-dining-readonly', version: '0.1.0' } } } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  const data = raw.startsWith('data:') ? JSON.parse(raw.split('\n').find(line => line.startsWith('data:'))!.slice(5)) : JSON.parse(raw);
  if (data.error) throw new Error(`MCP error ${data.error.code}`);
  return { data, session: response.headers.get('mcp-session-id') ?? session };
}

export async function probe(name: keyof typeof SERVICES) {
  const service = SERVICES[name];
  const token = process.env[service.env];
  if (!token) return { service: name, status: 'UNAVAILABLE', reason: `${service.env} absent` };
  try {
    const init = await rpc(service.url, token, 'initialize');
    const list = await rpc(service.url, token, 'tools/list', init.session ?? undefined);
    const names = (list.data.result?.tools ?? []).map((tool: { name: string }) => tool.name);
    return { service: name, status: 'CONNECTED', tools: names };
  } catch (error) {
    return { service: name, status: 'UNAVAILABLE', reason: String(error).replace(token, '[REDACTED]') };
  }
}

if (import.meta.main) {
  for (const name of ['luckin', 'mcdonalds'] as const) console.log(JSON.stringify(await probe(name)));
}
