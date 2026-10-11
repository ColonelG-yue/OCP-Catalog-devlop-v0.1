import Ajv from 'ajv';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { withMcp, decodeToolResult } from './mcp-probe';

export type ToolClient = Pick<Client, 'listTools' | 'callTool'>;
export type Connection = <T>(work: (client: ToolClient) => Promise<T>) => Promise<T>;
export class MerchantFailure extends Error { constructor(public readonly unknownOutcome: boolean) { super(unknownOutcome ? 'Merchant outcome unknown; do not retry creation' : 'Merchant operation failed'); } }
export type Store = { id: number; name: string; address: string; longitude: number; latitude: number };
export type Line = { productId: number; skuCode: string; amount: number };
export type Draft = { store: Store; line: Line; coupons: string[] };

export class LuckinGateway {
  private connection: Connection;
  private allowCreation: boolean;
  constructor(connection?: Connection, allowCreation = false, mode: 'live' | 'mock' = 'live') {
    this.connection = connection ?? (work => withMcp('luckin', work));
    this.allowCreation = allowCreation && (mode === 'mock' && Boolean(connection) || (process.env.AGENTMALL_TEST_MODE !== '1' && process.env.AGENTMALL_DATA_MODE !== 'mock' && process.env.NODE_ENV === 'production'));
  }
  private async invoke(name: string, args: Record<string, unknown>, submission = false): Promise<any> {
    if (!['queryShopList', 'searchProductForMcp', 'queryProductDetailInfo', 'previewOrder', 'queryOrderDetailInfo', 'createOrder'].includes(name)) throw new Error('Unsupported transaction tool');
    if (name === 'createOrder' && !this.allowCreation) throw new Error('Real creation disabled');
    return this.connection(async client => {
      // All validation and connection setup occur before dispatch; no create retry exists.
      const { tools } = await client.listTools(undefined, { timeout: 10000 });
      const tool = tools.find(tool => tool.name === name);
      const ajv = new Ajv({ strict: false, validateFormats: false });
      if (!tool || !ajv.validate(tool.inputSchema, args)) throw new Error('Merchant input schema rejected arguments');
      let response: unknown;
      try { response = await client.callTool({ name, arguments: args }, undefined, { timeout: 12000 }); }
      catch { throw new MerchantFailure(submission); }
      let data: any;
      try { data = decodeToolResult(response); } catch { throw new MerchantFailure(submission); }
      if (data.success !== true || !data.data || typeof data.data !== 'object') throw new MerchantFailure(submission);
      return data.data;
    });
  }
  async stores(longitude: number, latitude: number, deptName?: string): Promise<Store[]> {
    const data = await this.invoke('queryShopList', { longitude, latitude, ...(deptName ? { deptName } : {}) });
    if (!Array.isArray(data)) throw new Error('Unexpected store response');
    return data.filter(item => item.workStatus === '营业中' && Number.isInteger(item.deptId) && typeof item.address === 'string' && typeof item.deptName === 'string' && Number.isFinite(item.longitude) && Number.isFinite(item.latitude))
      .map(item => ({ id: item.deptId, name: item.deptName, address: item.address, longitude: item.longitude, latitude: item.latitude }));
  }
  async search(store: Store, query: string): Promise<any[]> {
    const data = await this.invoke('searchProductForMcp', { deptId: store.id, query });
    if (!Array.isArray(data)) throw new Error('Unexpected product response');
    return data;
  }
  detail(store: Store, productId: number) { return this.invoke('queryProductDetailInfo', { deptId: store.id, productId }); }
  preview(store: Store, line: Line) { return this.invoke('previewOrder', { deptId: store.id, productList: [{ ...line }] }); }
  create(draft: Draft) {
    // Coordinates come from the confirmed merchant store, never demo/user approximations.
    return this.invoke('createOrder', { deptId: draft.store.id, productList: [{ ...draft.line }], longitude: draft.store.longitude, latitude: draft.store.latitude, couponCodeList: [...draft.coupons] }, true);
  }
  status(orderId: string) { return this.invoke('queryOrderDetailInfo', { orderId }); }
}
