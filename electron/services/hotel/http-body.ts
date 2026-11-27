import type { IncomingMessage } from 'node:http';
import { HotelDomainError } from './domain';

export async function readHotelJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > 1024 * 1024) throw new HotelDomainError('请求超过 1 MB，请减少输入或使用来源引用', 413);
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object expected');
    return value as T;
  } catch { throw new HotelDomainError('请求必须是有效的 JSON 对象', 400); }
}
