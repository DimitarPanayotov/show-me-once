import type { Readable, Writable } from "node:stream";

const MAX_MESSAGE = 200_000;
export function writeNative(output: Writable, value: object) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > MAX_MESSAGE) throw new Error("Native message too large.");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length);
  output.write(Buffer.concat([header, data]));
}

export async function readNative(input: Readable): Promise<unknown> {
  let data = Buffer.alloc(0);
  for await (const chunk of input.iterator({ destroyOnReturn: false })) {
    data = Buffer.concat([data, Buffer.from(chunk)]);
    if (data.length < 4) continue;
    const length = data.readUInt32LE(0);
    if (!length || length > MAX_MESSAGE)
      throw new Error("Invalid native message size.");
    if (data.length > length + 4)
      throw new Error("Only one native request is allowed.");
    if (data.length === length + 4)
      return JSON.parse(data.subarray(4).toString("utf8"));
  }
  throw new Error("Incomplete native message.");
}
