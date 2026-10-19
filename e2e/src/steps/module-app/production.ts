import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';

const requiredEnvironment = [
  'MODULE_APP_E2E_APP_ID',
  'MODULE_APP_E2E_DENIED_WORKSPACE_ID',
  'MODULE_APP_E2E_PAID_APP_ID',
  'MODULE_APP_E2E_PENDING_APP_ID',
  'MODULE_APP_E2E_REFUNDED_APP_ID',
  'MODULE_APP_E2E_REVOKED_APP_ID',
  'MODULE_APP_E2E_RUN_ID',
  'MODULE_APP_E2E_TEAM_WORKSPACE_ID',
] as const;

const env = (key: (typeof requiredEnvironment)[number]) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
};

const open = async (world: CustomWorld, path: string) => {
  const response = await world.page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
};

Given(
  'the Module App production gate environment is configured',
  async function (this: CustomWorld) {
    const missing = requiredEnvironment.filter((key) => !process.env[key]?.trim());
    expect(missing, `Missing staging fixtures: ${missing.join(', ')}`).toEqual([]);
    const session = await this.page.request.get('/api/auth/get-session');
    expect(session.ok(), 'Authenticated staging session request failed').toBe(true);
    const body = await session.json();
    expect(
      body?.user?.id,
      'Module App production probes require an authenticated user',
    ).toBeTruthy();
  },
);

When('I open the configured Module App detail page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_APP_ID')}`);
});

When('I open the Module App developer console', async function (this: CustomWorld) {
  await open(this, '/apps/developer');
});

When(
  'I open the Module App developer console on a phone viewport',
  async function (this: CustomWorld) {
    await this.page.setViewportSize({ height: 844, width: 390 });
    await open(this, '/apps/developer');
  },
);

When('I open the configured Module App runtime page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_APP_ID')}/app`);
});

When(
  'I open the configured Module App runtime page with its workflow run',
  async function (this: CustomWorld) {
    await open(
      this,
      `/apps/${env('MODULE_APP_E2E_APP_ID')}/app?runId=${env('MODULE_APP_E2E_RUN_ID')}`,
    );
  },
);

When('I open the configured denied workspace runtime page', async function (this: CustomWorld) {
  await open(
    this,
    `/apps/${env('MODULE_APP_E2E_APP_ID')}/app?workspaceId=${env('MODULE_APP_E2E_DENIED_WORKSPACE_ID')}`,
  );
});

When('I open the configured team workspace runtime page', async function (this: CustomWorld) {
  await open(
    this,
    `/apps/${env('MODULE_APP_E2E_APP_ID')}/app?workspaceId=${env('MODULE_APP_E2E_TEAM_WORKSPACE_ID')}`,
  );
});

When('I open the configured revoked-license runtime page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_REVOKED_APP_ID')}/app`);
});

When('I open the configured pending-payment detail page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_PENDING_APP_ID')}`);
});

When('I open the configured paid-order detail page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_PAID_APP_ID')}`);
});

When('I open the configured refunded-order detail page', async function (this: CustomWorld) {
  await open(this, `/apps/${env('MODULE_APP_E2E_REFUNDED_APP_ID')}`);
});

Then('the Module App detail should render', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('module-app-detail')).toBeVisible();
});

Then('the Module App developer console should render', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('module-app-developer-console')).toBeVisible();
});

Then(
  'the Module App developer console should render without horizontal overflow',
  async function (this: CustomWorld) {
    await expect(this.page.getByTestId('module-app-developer-console')).toBeVisible();
    await expect
      .poll(() =>
        this.page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  },
);

Then(
  'the Module App runtime should render without a launch error',
  async function (this: CustomWorld) {
    await expect(this.page.getByTestId('module-app-runtime')).toBeVisible();
    await expect(this.page.getByText(/runtime unavailable|build not ready/i)).toHaveCount(0);
  },
);

Then('persisted workflow progress should be visible', async function (this: CustomWorld) {
  await expect(this.page.getByRole('progressbar')).toBeVisible();
});

Then('the latest executable action result should be visible', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('module-app-recent-run')).toBeVisible();
});

Then('the Module App runtime should show a denied state', async function (this: CustomWorld) {
  await expect(this.page.getByTestId('module-app-runtime')).toBeVisible();
  await expect(this.page.locator('[role="alert"]')).toBeVisible();
});

Then('the Module App detail should show pending payment', async function (this: CustomWorld) {
  await expect(this.page.getByText(/pending/i)).toBeVisible();
});

Then('the Module App detail should show paid confirmation', async function (this: CustomWorld) {
  await expect(this.page.getByText(/confirmed|paid/i)).toBeVisible();
});

Then('the Module App detail should show refunded state', async function (this: CustomWorld) {
  await expect(this.page.getByText(/refunded/i)).toBeVisible();
});
