interface AutoCasdoorOptions {
  inProgress: boolean;
  preferEmail: boolean;
  providerAvailable: boolean;
  ready: boolean;
  started: boolean;
}

export const shouldAutoStartCasdoor = ({
  inProgress,
  preferEmail,
  providerAvailable,
  ready,
  started,
}: AutoCasdoorOptions) => ready && providerAvailable && !preferEmail && !inProgress && !started;
