(() => {
  "use strict";

  const domainEntries = [
    ["fab", "01 Fab 基础/厂务"], ["gas", "02 特气系统"],
    ["chemical", "03 化学供液/CDS"], ["upw", "04 UPW 超纯水"],
    ["wastewater", "05 废水处理"], ["vacuum", "06 真空/尾气"],
    ["hvac", "07 HVAC/洁室"], ["electrical", "08 电气"],
    ["plc", "09 PLC 控制器"], ["instrument", "10 仪表/传感器"],
    ["ot", "11 OT 网络"], ["secs", "12 SECS/GEM"],
    ["ehs", "13 EHS 安全"], ["cad", "14 CAD 制图"],
    ["construction", "15 施工"], ["commissioning", "16 调试"],
    ["troubleshooting", "17 排障"], ["standards", "18 标准地图"],
  ];
  const dialog = document.querySelector("#company-submit-dialog");
  const open = document.querySelector("#company-submit-open");
  const close = document.querySelector("#company-submit-close");
  const cancel = document.querySelector("#company-submit-cancel");
  const form = document.querySelector("#company-submit-form");
  const domains = document.querySelector("#company-submit-domains");
  const stage = document.querySelector("#directory-captcha-stage");
  const range = document.querySelector("#directory-captcha-range");
  const refresh = document.querySelector("#directory-captcha-refresh");
  const status = document.querySelector("#company-submit-status");
  if (![dialog, open, close, cancel, form, domains, stage, range, refresh, status].every(Boolean)) return;

  domainEntries.forEach(([value, label]) => {
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "domains";
    input.value = value;
    wrapper.append(input, document.createTextNode(label));
    domains.append(wrapper);
  });

  let captcha = null;
  const json = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({ detail: "服务返回无效" }));
    if (!response.ok) throw new Error(payload.detail || `请求失败 (${response.status})`);
    return payload;
  };
  const renderPiece = () => {
    const piece = stage.querySelector(".captcha-piece");
    if (piece) piece.style.transform = `translateX(${range.value}px)`;
  };
  const loadCaptcha = async () => {
    status.textContent = "正在载入人机验证…";
    captcha = await json("/directory-api/captcha/new");
    stage.replaceChildren();
    const background = new Image();
    background.src = `data:image/jpeg;base64,${captcha.bg}`;
    background.alt = "人机验证底图";
    const piece = new Image();
    piece.src = `data:image/png;base64,${captcha.piece}`;
    piece.alt = "可移动拼图块";
    piece.className = "captcha-piece";
    piece.style.top = `${captcha.piece_y}px`;
    stage.append(background, piece);
    range.max = String(captcha.width - captcha.piece_size);
    range.value = "0";
    renderPiece();
    status.textContent = "";
  };
  const closeDialog = () => dialog.close();
  open.addEventListener("click", async () => {
    dialog.showModal();
    try { await loadCaptcha(); } catch (error) { status.textContent = error.message; }
  });
  close.addEventListener("click", closeDialog);
  cancel.addEventListener("click", closeDialog);
  refresh.addEventListener("click", async () => {
    try { await loadCaptcha(); } catch (error) { status.textContent = error.message; }
  });
  range.addEventListener("input", renderPiece);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const checkedDomains = [...form.querySelectorAll('input[name="domains"]:checked')].map((input) => input.value);
    if (!checkedDomains.length) {
      status.textContent = "请至少选择一个覆盖领域。";
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "正在提交审核…";
    try {
      if (!captcha) throw new Error("请先完成人机验证");
      const verified = await json("/directory-api/captcha/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha_id: captcha.captcha_id, x: Number(range.value) }),
      });
      const data = new FormData(form);
      const payload = Object.fromEntries(data.entries());
      payload.domains = checkedDomains;
      payload.captcha_token = verified.captcha_token;
      const result = await json("/directory-api/directory/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      form.reset();
      captcha = null;
      stage.replaceChildren();
      status.textContent = `${result.message} 受理编号：${result.request_id}`;
    } catch (error) {
      const message = error.message;
      try { await loadCaptcha(); } catch { /* 保留原错误 */ }
      status.textContent = message;
    } finally {
      submit.disabled = false;
    }
  });
})();
