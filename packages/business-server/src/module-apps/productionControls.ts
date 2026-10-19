export const assertModuleAppMutationEnabled = (enabled: boolean, errorCode: string) => {
  if (!enabled) throw new Error(errorCode);
};
export const assertModuleAppRolloutAllowed = (
  identity: { appId?: null | string; publisherId?: null | string },
  rollout: { appIds: string[]; publisherIds: string[] },
) => {
  if (
    (identity.appId && rollout.appIds.includes(identity.appId)) ||
    (identity.publisherId && rollout.publisherIds.includes(identity.publisherId))
  ) {
    return;
  }
  throw new Error('MODULE_APP_ROLLOUT_NOT_ALLOWED');
};
