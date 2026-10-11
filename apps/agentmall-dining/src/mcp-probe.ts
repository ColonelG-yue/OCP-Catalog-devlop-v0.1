import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type Merchant = 'luckin' | 'mcdonalds';
const SERVICES = {
  luckin: { url: 'https://gwmcp.lkcoffee.com/order/user/mcp', env: 'LUCKIN_MCP_TOKEN' },
  mcdonalds: { url: 'https://mcp.mcd.cn', env: 'MCD_MCP_TOKEN' },
} as const;

export async function withMcp<T>(name: Merchant, work: (client: Client) => Promise<T>): Promise<T> {
  const service = SERVICES[name];
  const token = process.env[service.env];
  if (!token) throw new Error(`${service.env} unavailable`);
  const client = new Client({ name: 'agentmall-dining-readonly', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(service.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  // Keep SDK/transport errors out of logs because they may contain request context.
  client.onerror = () => {};
  try {
    await client.connect(transport, { timeout: 10000 });
    return await work(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function probe(name: Merchant) {
  try {
    const tools = await withMcp(name, async client => {
      const result = await client.listTools(undefined, { timeout: 10000 });
      return result.tools.map(({ name, inputSchema }) => ({ name, inputSchema }));
    });
    await Bun.write(new URL(`../docs/${name}-tools.json`, import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), tools }, null, 2));
    return { service: name, status: 'CONNECTED', tool_names: tools.map(tool => tool.name) };
  } catch {
    return { service: name, status: 'UNAVAILABLE', reason: 'Connection or tools/list failed; credentials and errors withheld' };
  }
}

if (import.meta.main) {
  for (const name of ['luckin', 'mcdonalds'] as const) console.log(JSON.stringify(await probe(name)));
}

// Extract JSON data from text blocks without interpreting surrounding merchant instructions.
export function decodeToolResult(input: unknown): any {
  if (!input || typeof input !== 'object') throw new Error('Invalid merchant result');
  const result = input as { structuredContent?: unknown; content?: unknown; isError?: boolean };
  if (result.isError) throw new Error('Merchant tool rejected request');
  if (result.structuredContent) return result.structuredContent;
  for (const block of (result.content ?? []) as { type: string; text?: string }[]) {
    if (block.type !== 'text' || !block.text) continue;
    const text = block.text;
    for (let start = 0; start < text.length; start++) {
      if (text[start] !== '{' && text[start] !== '[') continue;
      let depth = 0, quoted = false, escape = false;
      for (let end = start; end < text.length; end++) {
        const c = text[end];
        if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
        if (c === '"') quoted = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        if (depth === 0) {
          try { const parsed = JSON.parse(text.slice(start, end + 1)); if (parsed && (parsed.data !== undefined || (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object'))) return parsed; } catch {}
          break;
        }
      }
    }
  }
  throw new Error('No structured merchant data');
}


const READ_TOOLS: Record<Merchant, readonly string[]> = {
  luckin: ['queryShopList', 'searchProductForMcp', 'queryProductDetailInfo'],
  mcdonalds: ['query-nearby-stores', 'query-meals', 'query-meal-detail'],
};
export async function callReadTool(client: Client, merchant: Merchant, name: string, args: Record<string, unknown>, tools: Awaited<ReturnType<Client['listTools']>>['tools']) {
  if (!READ_TOOLS[merchant].includes(name)) throw new Error('Tool is outside the read-only allowlist');
  const tool = tools.find(tool => tool.name === name);
  if (!tool) throw new Error('Tool not advertised by merchant');
  const ajv = new Ajv({ strict: false, validateFormats: false });
  if (!ajv.validate(tool.inputSchema, args)) throw new Error('Arguments do not match merchant input schema');
  const data = decodeToolResult(await client.callTool({ name, arguments: args }, undefined, { timeout: 10000 }));
  if (data.success === false || (typeof data.code === 'number' && ![0, 200].includes(data.code))) throw new Error('Merchant data unavailable');
  return data;
}
