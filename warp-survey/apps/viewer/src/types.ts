export interface LoadState {
  status: "idle" | "loading" | "loaded" | "error";
  progress: number;
  error?: string;
}

export interface ViewerConfig {
  manifestUrl: string;
  canvas: HTMLCanvasElement;
}

export interface LoadedSplat {
  entity: any;
  asset: any;
  bytes: number;
}
