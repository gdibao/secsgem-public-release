import { defineMigration } from './defineMigration';

export default defineMigration({
  id: '002-isolate-legacy-qingyou-cloud-tokens',
  up: (store) => {
    const dataSyncConfig = store.get('dataSyncConfig');
    const encryptedTokens = store.get('encryptedTokens');

    // The broken Chituo release used Qingyou only through the cloud default.
    // Keep explicit self-host configurations and their credentials untouched.
    if (dataSyncConfig?.storageMode !== 'cloud' || !encryptedTokens) return;
    if (!Object.values(encryptedTokens).some((value) => value !== undefined)) return;

    store.set('chituoLegacyQingyouTokensBackupV1', encryptedTokens);
    store.set('encryptedTokens', {});
    store.set('dataSyncConfig', { ...dataSyncConfig, active: false });
  },
});
