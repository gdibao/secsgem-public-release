# Module App SDK

The Module App SDK provides the typed browser bridge used by sandboxed ComHub Module Apps.

```ts
import { createModuleAppSdk, waitForModuleAppLaunch } from '@lobechat/module-app-sdk';

const nonce = new URLSearchParams(location.search).get('nonce')!;
const launch = await waitForModuleAppLaunch({ nonce });
const sdk = createModuleAppSdk({ nonce, runtimeOrigin: launch.hostOrigin });
const records = await sdk.data.list({ tableKey: 'items' });
```

Use the LobeHub CLI to create and package an application:

```bash
lh module-app init my-app
lh module-app validate my-app
lh module-app pack my-app
```

The runtime grants only the capabilities declared by the reviewed manifest and the current installation.
