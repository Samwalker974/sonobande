declare module '@piper-phonemize' {
  export interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (path: string, prefix?: string) => string;
    wasmBinary?: ArrayBuffer;
    getPreloadedPackage?: (remotePackageName: string, remotePackageSize: number) => ArrayBuffer | null;
    noExitRuntime?: boolean;
  }

  export interface PiperPhonemizeModule {
    callMain: (args: string[]) => number;
  }

  export function createPiperPhonemize(
    options?: PiperPhonemizeOptions
  ): Promise<PiperPhonemizeModule>;
}
