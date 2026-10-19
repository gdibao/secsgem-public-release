export type ModuleAppBuildWorkerRequest = {
  artifactKey: string;
  buildId: string;
  buildProfile: 'node22-static' | 'python312-assets';
  claimToken: string;
  sourceDownloadUrl: string;
  sourceSha256: string;
  uploadHeaders: Record<string, string>;
  uploadUrl: string;
};

export type ModuleAppBuildResult =
  | {
      artifactKey: string;
      artifactSha256: string;
      buildId: string;
      claimToken: string;
      status: 'ready';
    }
  | {
      buildId: string;
      claimToken: string;
      failureCode: string;
      status: 'failed';
    };
