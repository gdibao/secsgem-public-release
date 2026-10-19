(() => {
  'use strict';
  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#navigation');
  const closeMenu = () => {
    if (!menu || !nav) return;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', '打开导航');
    nav.classList.remove('open');
  };
  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
    nav.classList.toggle('open', open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
    }
  });
  const tabs = [...document.querySelectorAll('[role="tab"][aria-controls]')]
    .filter(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const activateTab = tab => {
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        activateTab(tabs[next]);
        tabs[next].focus();
      }
    });
  });
  async function copyText(value, status, fallback) {
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = '已复制到剪贴板。';
    } catch {
      if (fallback) { fallback.focus(); fallback.select(); }
      status.textContent = '浏览器未允许复制，请手动选择并复制' + (fallback ? '上方摘要。' : '邮箱：wodekefu@gmail.com');
    }
  }
  document.querySelector('#copy-email')?.addEventListener('click', () => copyText('wodekefu@gmail.com', document.querySelector('#email-status')));
  const form = document.querySelector('#requirements-form');
  if (!form) return;
  const result = document.querySelector('#requirements-result');
  const summary = document.querySelector('#summary');
  const status = document.querySelector('#form-status');
  const email = document.querySelector('#email-summary');
  form.addEventListener('change', () => {
    if (!result.hidden) {
      result.hidden = true;
      status.textContent = '需求已调整，请重新生成摘要。';
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const materials = data.getAll('materials');
    const text = [
      '驰拓AI助手 | 私有化 AI 部署需求',
      '',
      `应用场景：${data.get('scenario')}`,
      `资料类型：${materials.length ? materials.join('、') : '待评估'}`,
      `部署网络：${data.get('network')}`,
      `使用规模：${data.get('scale')}`,
      `算力条件：${data.get('compute')}`,
      '',
      '希望讨论：部署范围、数据流边界、权限策略、试点与验收安排。',
      '本摘要不含原始业务资料；具体功能及交付范围待共同确认。'
    ].join('\n');
    summary.value = text;
    email.href = 'mailto:wodekefu@gmail.com?subject=' + encodeURIComponent('驰拓AI助手 - 私有化 AI 部署咨询') + '&body=' + encodeURIComponent(text);
    result.hidden = false;
    status.textContent = '摘要已在本地生成，尚未发送或提交。';
    summary.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  });
  document.querySelector('#copy-summary').addEventListener('click', () => copyText(summary.value, status, summary));
  document.querySelector('#download-summary').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', summary.value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '驰拓AI助手-部署需求.txt';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '已生成下载文件，未向服务器提交。';
  });
  email.addEventListener('click', () => { status.textContent = '正在请求打开邮件客户端；尚未发送。如未打开，请复制摘要并自行发送邮件。'; });
})();
