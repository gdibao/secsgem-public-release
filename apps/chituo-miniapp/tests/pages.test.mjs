import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
function page(name, wx = {}) {
  let instance;
  vm.runInNewContext(read(`miniprogram/pages/${name}/${name}.js`), {
    wx,
    Page(value) { instance = value; },
  });
  instance.setData = (patch) => Object.assign(instance.data, patch);
  return instance;
}

test('project keeps real-domain checks and all declared pages exist', () => {
  const project = JSON.parse(read('project.config.json'));
  assert.equal(project.appid, 'touristappid');
  assert.equal(project.setting.urlCheck, true);
  assert.equal(project.compileType, 'miniprogram');
  for (const name of JSON.parse(read('miniprogram/app.json')).pages) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(new URL(`${project.miniprogramRoot}${name}.${ext}`, root)));
    }
  }
  assert.match(read('.gitignore'), /project\.private\.config\.json/);
});

test('offline cannot enter; returning after network recovery can enter', () => {
  let networkType = 'none';
  const messages = [];
  const routes = [];
  const p = page('index', {
    getNetworkType: ({ success }) => success({ networkType }),
    showToast: ({ title }) => messages.push(title),
    navigateTo: ({ url }) => routes.push(url),
  });
  p.onShow();
  p.openFab();
  assert.equal(p.data.online, false);
  assert.equal(messages.length, 1);
  assert.equal(routes.length, 0);
  networkType = 'wifi';
  p.onShow();
  p.openFab();
  assert.equal(p.data.online, true);
  assert.deepEqual(routes, ['/pages/fab/fab']);
});

test('failed network detection remains explicit and blocks navigation', () => {
  const p = page('index', { getNetworkType: ({ fail }) => fail() });
  p.onShow();
  assert.equal(p.data.online, false);
  assert.equal(p.data.networkLabel, '网络状态未知');
});

test('web-view retries only Fab and never substitutes an upstream host', () => {
  let clipboard;
  const p = page('fab', { setClipboardData: ({ data }) => { clipboard = data; } });
  assert.equal(p.data.fabUrl, 'https://fab.gdibao.com/');
  p.handleError();
  assert.equal(p.data.failed, true);
  p.retry();
  assert.equal(p.data.failed, false);
  const url = new URL(p.data.fabUrl);
  assert.equal(url.origin, 'https://fab.gdibao.com');
  assert.equal(url.pathname, '/');
  assert.ok(url.searchParams.get('miniapp_retry'));
  p.handleLoad();
  assert.equal(p.data.failed, false);
  p.copyAddress();
  assert.equal(clipboard, 'https://fab.gdibao.com/');
  const markup = read('miniprogram/pages/fab/fab.wxml');
  assert.match(markup, /bindload="handleLoad"/);
  assert.match(markup, /binderror="handleError"/);
});

test('both share handlers expose only the public launch route', () => {
  for (const name of ['index', 'fab']) {
    const shared = page(name).onShareAppMessage();
    assert.equal(shared.path, '/pages/index/index');
    assert.equal(shared.title, '驰拓 AI 助手');
  }
});
