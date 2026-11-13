export declare class CaptureProcessor {
  constructor(opts?: { inputRate?: number; emit?: (buf: ArrayBuffer) => void });
  write(samples: Float32Array): void;
  process(inputs: Float32Array[][]): boolean;
}
