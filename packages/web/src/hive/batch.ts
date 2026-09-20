import type { HiveOperation } from '@lister/core/hive';
/** Leave room for HTTP overhead and validate before sending a retained outbox. */
export function operationBatch(outbox: HiveOperation[]): HiveOperation[] {
  const operations: HiveOperation[] = [];
  let bytes = 32;
  const encoder = new TextEncoder();
  for (const operation of outbox.slice(0,100)) {
    const length = encoder.encode(JSON.stringify(operation)).byteLength + 1;
    if (bytes + length > 8 * 1024 * 1024) {
      if (!operations.length) throw new Error('This edit is too large to upload. Export the browser backup before recovering it on the owning computer.');
      break;
    }
    operations.push(operation);bytes += length;
  }
  return operations;
}
