export declare class PcmQueue {
  length: number;
  push(samples: Float32Array): void;
  flush(): void;
  read(out: Float32Array): number;
}
export declare class PlaybackProcessor {
  queue: PcmQueue;
  playing: boolean;
  onMessage(m: { type: 'audio'; samples: Float32Array } | { type: 'flush' }): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
