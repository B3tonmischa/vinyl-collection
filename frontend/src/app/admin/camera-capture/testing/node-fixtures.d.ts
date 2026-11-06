// disc-detect.spec.ts reads fixture files. Specs run in Node, but the project
// has no @types/node, and this is all they need of it.

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:zlib' {
  export function gunzipSync(data: Uint8Array): Uint8Array;
}
