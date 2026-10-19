const sdk = await import('../dist/index.js');

if (
  typeof sdk.createModuleAppSdk !== 'function' ||
  typeof sdk.waitForModuleAppLaunch !== 'function'
) {
  throw new Error('MODULE_APP_SDK_PACKAGE_EXPORTS_INVALID');
}
