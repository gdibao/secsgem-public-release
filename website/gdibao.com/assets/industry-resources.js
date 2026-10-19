(async () => {
  "use strict";
  const domains = [
    ["01", "fab", "Fab 基础/厂务"],
    ["02", "gas", "特气系统"],
    ["03", "chemical", "化学供液/CDS"],
    ["04", "upw", "UPW 超纯水"],
    ["05", "wastewater", "废水处理"],
    ["06", "vacuum", "真空/尾气"],
    ["07", "hvac", "HVAC/洁室"],
    ["08", "electrical", "电气"],
    ["09", "plc", "PLC 控制器"],
    ["10", "instrument", "仪表/传感器"],
    ["11", "ot", "OT 网络"],
    ["12", "secs", "SECS/GEM"],
    ["13", "ehs", "EHS 安全"],
    ["14", "cad", "CAD 制图"],
    ["15", "construction", "施工"],
    ["16", "commissioning", "调试"],
    ["17", "troubleshooting", "排障"],
    ["18", "standards", "标准地图"],
  ];
  const domainMap = Object.fromEntries(
    domains.map(([number, id, name]) => [id, { number, name }]),
  );
  const resources = [
    {
      name: "Exyte",
      cn: "爱思强",
      role: "集成商",
      use: "高科技设施与半导体晶圆厂的设计、工程和建设服务。",
      domains: ["fab", "hvac", "electrical", "construction", "commissioning"],
      url: "https://www.exyte.net/Markets",
    },
    {
      name: "Jacobs",
      cn: "雅各布斯",
      role: "集成商",
      use: "半导体设施全生命周期工程、EPCM、厂务与设备接入。",
      domains: ["fab", "construction", "commissioning"],
      url: "https://www.jacobs.com/industries/semiconductors",
    },
    {
      name: "Linde",
      cn: "林德",
      role: "供应商",
      use: "电子级大宗气体、特气及配套供气能力。",
      domains: ["gas", "ehs"],
      url: "https://www.linde.com/about-us/our-expertise/gases",
    },
    {
      name: "Air Liquide Electronics",
      cn: "液化空气电子业务",
      role: "供应商",
      use: "半导体气体、先进材料、设备与现场服务。",
      domains: ["gas", "chemical", "ehs"],
      url: "https://electronics.airliquide.com/who-we-are/our-markets/semiconductors",
    },
    {
      name: "Fujikin",
      cn: "富士金",
      role: "制造商",
      use: "半导体高纯气体阀门及流体控制元件。",
      domains: ["gas", "instrument"],
      url: "https://www.fujikin.co.jp/en/support/basic/",
    },
    {
      name: "Swagelok",
      cn: "世伟洛克",
      role: "制造商",
      use: "半导体高纯流体系统的管件、阀门与组件。",
      domains: ["gas", "chemical", "instrument"],
      url: "https://arbor.swagelok.com/en/markets/semiconductor",
    },
    {
      name: "KITZ SCT",
      cn: "开滋半导体",
      role: "制造商",
      use: "半导体高纯气体、真空与湿法流体阀门。",
      domains: ["gas", "chemical", "vacuum"],
      url: "https://en.kitzsct.com/",
    },
    {
      name: "Kurita Water Industries",
      cn: "栗田工业",
      role: "供应商",
      use: "电子行业超纯水、废水处理、回用与水处理服务。",
      domains: ["upw", "wastewater", "commissioning"],
      url: "https://www.kurita-water.com/en/industries/electron.html",
    },
    {
      name: "Organo",
      cn: "奥加诺",
      role: "供应商",
      use: "超纯水、废水与回收系统的设计、制造、安装和运维。",
      domains: ["upw", "wastewater", "construction", "commissioning"],
      url: "https://www.organo.co.jp/en/business/plant/",
    },
    {
      name: "EBARA Precision Machinery",
      cn: "荏原精密机械",
      role: "制造商",
      use: "半导体干式真空泵、尾气处理及精密设备。",
      domains: ["vacuum", "troubleshooting"],
      url: "https://www.ebara.com/global-en/precision/",
    },
    {
      name: "Edwards Vacuum",
      cn: "爱德华真空",
      role: "制造商",
      use: "半导体真空泵、SubFab 集成与尾气处理方案。",
      domains: ["vacuum", "ehs", "troubleshooting"],
      url: "https://www.edwardsvacuum.com/en-in/semiconductor",
    },
    {
      name: "Pfeiffer Vacuum",
      cn: "普发真空",
      role: "制造商",
      use: "晶圆传输、负载锁与工艺腔体真空解决方案。",
      domains: ["vacuum", "troubleshooting"],
      url: "https://www.pfeiffer-vacuum.com/global/en/markets/semiconductor/wafer-handling",
    },
    {
      name: "AAF International",
      cn: "AAF 国际",
      role: "制造商",
      use: "微电子洁净室空气过滤与污染控制。",
      domains: ["hvac", "fab"],
      url: "https://www.aafintl.com/us/industries/electronics/microelectronics",
    },
    {
      name: "Envirco",
      cn: "Envirco",
      role: "制造商",
      use: "洁净室风机过滤单元（FFU）及空气洁净设备。",
      domains: ["hvac", "fab"],
      url: "https://www.envirco-hvac.com/products/index.aspx",
    },
    {
      name: "Schneider Electric",
      cn: "施耐德电气",
      role: "制造商",
      use: "半导体厂电气配电、能源管理与自动化。",
      domains: ["electrical", "plc", "commissioning"],
      url: "https://www.se.com/sg/en/work/solutions/for-business/semiconductor/",
    },
    {
      name: "Siemens",
      cn: "西门子",
      role: "制造商",
      use: "半导体制造的电气、自动化与数字化产品和方案。",
      domains: ["electrical", "plc", "ot", "commissioning"],
      url: "https://www.siemens.com/en-us/industries/semiconductors/",
    },
    {
      name: "Omron Automation",
      cn: "欧姆龙自动化",
      role: "制造商",
      use: "半导体自动化、控制器、运动控制和传感方案。",
      domains: ["plc", "instrument", "commissioning"],
      url: "https://automation.omron.com/en/us/industries/semiconductor/",
    },
    {
      name: "Rockwell Automation",
      cn: "罗克韦尔自动化",
      role: "制造商",
      use: "半导体制造控制、工业网络与生命周期服务。",
      domains: ["plc", "ot", "commissioning", "troubleshooting"],
      url: "https://www.rockwellautomation.com/en-us/industries/semiconductor.html",
    },
    {
      name: "KEYENCE",
      cn: "基恩士",
      role: "制造商",
      use: "半导体尺寸、外观与过程测量传感器。",
      domains: ["instrument", "troubleshooting"],
      url: "https://www.keyence.com/products/measure/industries/semiconductor/",
    },
    {
      name: "Yokogawa",
      cn: "横河电机",
      role: "制造商",
      use: "半导体相关测量、控制与过程仪表资料。",
      domains: ["instrument", "plc", "commissioning"],
      url: "https://www.yokogawa.com/uk/industries/semiconductor/minimal-fab/",
    },
    {
      name: "Cisco",
      cn: "思科",
      role: "制造商",
      use: "制造业 OT/IT 融合、工业网络分区与参考架构。",
      domains: ["ot", "ehs"],
      url: "https://www.cisco.com/c/en/us/solutions/design-zone/industries/manufacturing/cpwe.html",
    },
    {
      name: "SEMI Standards",
      cn: "SEMI 国际标准",
      role: "标准组织",
      use: "半导体设备、材料、设施、安全及自动化标准入口。",
      domains: ["secs", "ehs", "standards"],
      url: "https://www.semi.org/en/products-services/standards",
    },
    {
      name: "Cimetrix / PDF Solutions",
      cn: "Cimetrix",
      role: "软件供应商",
      use: "SECS/GEM、GEM300 设备连接软件与标准实现资料。",
      domains: ["secs", "commissioning", "troubleshooting"],
      url: "https://www.cimetrix.com/CIMConnect-resources",
    },
    {
      name: "Autodesk Plant 3D",
      cn: "欧特克 Plant 3D",
      role: "软件供应商",
      use: "P&ID 与三维工厂设计、管道和设备建模。",
      domains: ["cad", "construction"],
      url: "https://www.autodesk.com/ca-en/products/autocad/included-toolsets/autocad-plant-3d",
    },
    {
      name: "ISO 14644-1",
      cn: "ISO 洁净室标准",
      role: "标准组织",
      use: "洁净室空气洁净度粒子浓度分级标准入口。",
      domains: ["fab", "hvac", "standards"],
      url: "https://www.iso.org/standard/53394.html",
    },
    {
      name: "IEC 61511",
      cn: "IEC 功能安全标准",
      role: "标准组织",
      use: "过程工业安全仪表系统生命周期标准入口。",
      domains: ["ehs", "instrument", "standards"],
      url: "https://webstore.iec.ch/en/publication/24241",
    },
  ];

  const directory = window.GDIBAO_INDUSTRY_DIRECTORY;
  if (!directory) return;
  const search = document.querySelector("#resource-search");
  const domain = document.querySelector("#resource-domain");
  const role = document.querySelector("#resource-role");
  const region = document.querySelector("#resource-region");
  const source = document.querySelector("#resource-source");
  const verifiedView = document.querySelector("#resource-view-verified");
  const pendingView = document.querySelector("#resource-view-pending");
  const reset = document.querySelector("#resource-reset");
  const grid = document.querySelector("#resource-grid");
  const count = document.querySelector("#resource-count");
  const empty = document.querySelector("#resource-empty");
  const pagination = document.querySelector("#resource-pagination");
  const previous = document.querySelector("#resource-prev");
  const next = document.querySelector("#resource-next");
  const pageLabel = document.querySelector("#resource-page");
  const required = [
    search,
    domain,
    role,
    region,
    source,
    verifiedView,
    pendingView,
    reset,
    grid,
    count,
    empty,
    pagination,
    previous,
    next,
    pageLabel,
  ];
  if (required.some((element) => !element)) return;

  const normalize = (value = "") =>
    String(value)
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN")
      .replace(/[\s·•・,，.。/\\|\-_—–'‘’"“”()（）\[\]【】]/g, "");
  let approvedSubmissions = [];
  try {
    const response = await fetch("/directory-api/directory/approved", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload.ok && Array.isArray(payload.items))
        approvedSubmissions = payload.items;
    }
  } catch {
    approvedSubmissions = [];
  }
  const sourceDefinitions = [
    ...directory.sources,
    {
      id: "official-resources-20260924",
      label: "18 域官网核验资源",
      kind: "official",
    },
    {
      id: "approved-submissions",
      label: "管理员核验企业申报",
      kind: "submission",
    },
  ];
  const sourceMap = Object.fromEntries(
    sourceDefinitions.map((item) => [item.id, item.label]),
  );
  const exhibitionMap = new Map();
  directory.exhibitions.forEach((item) => {
    exhibitionMap.set(item.companyId, [
      ...(exhibitionMap.get(item.companyId) || []),
      item,
    ]);
  });
  const companies = directory.companies.map((item) => ({
    ...item,
    exhibitions: exhibitionMap.get(item.id) || [],
  }));
  const identifierMap = new Map();
  const indexCompany = (company) => {
    [company.name, ...(company.aliases || [])].forEach((value) => {
      const key = normalize(value);
      if (key && !identifierMap.has(key)) identifierMap.set(key, company);
    });
  };
  companies.forEach(indexCompany);
  resources.forEach((item, index) => {
    const company =
      identifierMap.get(normalize(item.cn)) ||
      identifierMap.get(normalize(item.name));
    if (company) {
      company.aliases = [
        ...new Set([...company.aliases, item.name, item.cn]),
      ].filter((value) => normalize(value) !== normalize(company.name));
      company.role = item.role;
      company.use = item.use;
      company.domains = item.domains;
      company.url = item.url;
      company.verification = "verified_official";
      company.curatedPriority = true;
      company.priorityRank = index + 1;
      company.sourceRefs = [
        ...company.sourceRefs,
        {
          sourceId: "official-resources-20260924",
          recordId: `official-${String(index + 1).padStart(3, "0")}`,
        },
      ];
      return;
    }
    const official = {
      id: `official-${String(index + 1).padStart(3, "0")}`,
      name: item.cn,
      aliases: item.name === item.cn ? [] : [item.name],
      categories: [item.role],
      role: item.role,
      domains: item.domains,
      region: "海外/国际",
      verification: "verified_official",
      sourceRefs: [
        {
          sourceId: "official-resources-20260924",
          recordId: `official-${String(index + 1).padStart(3, "0")}`,
        },
      ],
      exhibitions: [],
      use: item.use,
      url: item.url,
    };
    companies.push(official);
    indexCompany(official);
  });
  approvedSubmissions.forEach((item) => {
    const key = normalize(item.name);
    if (!key || identifierMap.has(key)) return;
    const approved = {
      id: item.id,
      name: item.name,
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      categories: [item.role],
      role: item.role,
      domains: Array.isArray(item.domains) ? item.domains : [],
      region: item.region || "地区待核",
      verification: "verified_official",
      sourceRefs: [{ sourceId: "approved-submissions", recordId: item.id }],
      exhibitions: [],
      use: item.evidenceSummary || "企业申报经管理员核验后发布。",
      url: item.url,
      websiteStatus: "verified_accessible",
      curatedPriority: false,
      priorityRank: Number.MAX_SAFE_INTEGER,
    };
    companies.push(approved);
    indexCompany(approved);
  });

  const officialStatus = window.GDIBAO_OFFICIAL_STATUS?.byName || {};
  companies.forEach((item) => {
    const status = officialStatus[normalize(item.name)];
    if (!status) return;
    item.verification = "verified_official";
    item.websiteStatus = status.status;
    if (status.url) item.url = status.url;
  });

  const curatedPriority = window.GDIBAO_CURATED_PRIORITY || [];
  const curatedBySourceRecord = new Map(
    curatedPriority.map((item) => [`${item.sourceId}:${item.recordId}`, item]),
  );
  const curatedByCurrentId = new Map(
    curatedPriority.map((item) => [item.currentId, item]),
  );
  companies.forEach((item) => {
    const mapping =
      item.sourceRefs
        .map((record) =>
          curatedBySourceRecord.get(`${record.sourceId}:${record.recordId}`),
        )
        .find(Boolean) || curatedByCurrentId.get(item.id);
    item.curatedPriority = Boolean(mapping);
    item.priorityRank = mapping?.priorityRank ?? Number.MAX_SAFE_INTEGER;
  });

  const verificationLabels = {
    verified_official: "官网已核验",
    source_listed: "来源已收录",
    unverified: "待核验",
  };
  const regionBucket = (item) => {
    if (item.region === "中国" || /中国|北京|上海|江苏|浙江|广东|安徽|湖北|四川|陕西|天津|重庆|福建|山东|辽宁|吉林|江西|湖南|河南|河北|广西|贵州|云南|山西|甘肃|宁夏|青海|新疆|西藏|海南|内蒙古|香港|澳门/.test(item.region))
      return "china";
    if (!item.region || item.region === "待核") return "unknown";
    return "overseas";
  };
  const addTag = (container, text, className = "") => {
    const tag = document.createElement("span");
    if (className) tag.className = className;
    tag.textContent = text;
    container.append(tag);
  };

  domains.forEach(([number, id, name]) =>
    domain.add(new Option(`${number} · ${name}`, id)),
  );
  [...new Set(companies.map((item) => item.role))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .forEach((value) => role.add(new Option(value, value)));
  sourceDefinitions.forEach((item) =>
    source.add(new Option(item.label, item.id)),
  );
  source.add(new Option("CSEAC 2026 参展记录", "event:CSEAC 2026"));

  const requestedDomain = new URLSearchParams(location.search).get("domain");
  if (requestedDomain && domainMap[requestedDomain])
    domain.value = requestedDomain;

  const requestedSearch = new URLSearchParams(location.search).get("q");
  if (requestedSearch) search.value = requestedSearch;

  const pageSize = 24;
  let currentPage = 1;
  let lastFiltered = [];
  let activeView = "verified";

  const isAccessibleOfficial = (item) =>
    item.verification === "verified_official" &&
    item.websiteStatus === "verified_accessible" &&
    Boolean(item.url);

  const stableDirectoryOrder = (left, right) => {
    if (left.curatedPriority !== right.curatedPriority)
      return left.curatedPriority ? -1 : 1;
    if (left.curatedPriority && right.curatedPriority)
      return left.priorityRank - right.priorityRank;
    return (
      left.name.localeCompare(right.name, "zh-CN") ||
      left.id.localeCompare(right.id, "en")
    );
  };

  const createPriorityStars = () => {
    const stars = document.createElement("span");
    stars.className = "curated-priority";
    stars.setAttribute("aria-label", "目录优先级：五星");
    stars.title = "站点目录优先级；非质量、认证或合作背书";
    for (let index = 0; index < 5; index += 1) {
      const star = document.createElement("span");
      star.className = "priority-star";
      star.setAttribute("aria-hidden", "true");
      stars.append(star);
    }
    return stars;
  };

  const createCard = (item) => {
    const article = document.createElement("article");
    article.className = "resource-card directory-card";

    const badges = document.createElement("div");
    badges.className = "resource-badges";
    addTag(badges, item.role, "role");
    addTag(
      badges,
      verificationLabels[item.verification] || "待核验",
      `verification ${item.verification}`,
    );
    if (item.curatedPriority) badges.append(createPriorityStars());
    article.append(badges);

    const heading = document.createElement("h2");
    heading.textContent = item.name;
    if (item.aliases.length) {
      const aliases = document.createElement("small");
      aliases.textContent = item.aliases.slice(0, 3).join(" / ");
      heading.append(aliases);
    }
    article.append(heading);

    const description = document.createElement("p");
    description.textContent =
      item.use ||
      `来源分类：${item.categories.filter(Boolean).join(" / ") || "待分类"}。官网与业务边界尚待核验。`;
    article.append(description);

    const details = document.createElement("div");
    details.className = "directory-details";
    addTag(details, item.region || "地区待核");
    item.exhibitions.slice(0, 2).forEach((record) =>
      addTag(details, `${record.event}${record.booth ? ` · ${record.booth}` : ""}`),
    );
    article.append(details);

    const domainTags = document.createElement("div");
    domainTags.className = "domain-tags";
    if (item.domains.length) {
      item.domains.forEach((id) => {
        const entry = domainMap[id];
        if (entry) addTag(domainTags, `${entry.number} ${entry.name}`);
      });
    } else {
      addTag(domainTags, "18 域待分类", "pending");
    }
    article.append(domainTags);

    const sourceTags = document.createElement("div");
    sourceTags.className = "source-tags";
    [...new Set(item.sourceRefs.map((record) => record.sourceId))]
      .slice(0, 3)
      .forEach((id) => addTag(sourceTags, sourceMap[id] || id));
    article.append(sourceTags);

    if (
      item.url &&
      isAccessibleOfficial(item)
    ) {
      const link = document.createElement("a");
      link.className = "official-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `在新窗口打开 ${item.name} 官方网站`);
      link.textContent = "打开官方网站";
      const icon = document.createElement("img");
      icon.src = "/assets/icons/external-link.svg";
      icon.alt = "";
      icon.width = 15;
      icon.height = 15;
      link.append(icon);
      article.append(link);
    } else {
      const pending = document.createElement("span");
      pending.className = "official-link pending-link";
      pending.textContent =
        item.verification === "verified_official" &&
        item.websiteStatus === "verified_unreachable"
          ? "官网已核验，当前不可达"
          : "官网待核验";
      article.append(pending);
    }
    return article;
  };

  const renderPage = () => {
    const pages = Math.max(1, Math.ceil(lastFiltered.length / pageSize));
    currentPage = Math.min(Math.max(1, currentPage), pages);
    const start = (currentPage - 1) * pageSize;
    grid.replaceChildren(
      ...lastFiltered.slice(start, start + pageSize).map(createCard),
    );
    pageLabel.textContent = `第 ${currentPage} / ${pages} 页`;
    previous.disabled = currentPage === 1;
    next.disabled = currentPage === pages;
    pagination.hidden = lastFiltered.length <= pageSize;
  };

  const render = () => {
    const keyword = search.value.trim().toLocaleLowerCase("zh-CN");
    lastFiltered = companies.filter((item) => {
      const sourceIds = item.sourceRefs.map((record) => record.sourceId);
      const exhibitions = item.exhibitions.map((record) => record.event);
      const text = [
        item.name,
        ...item.aliases,
        item.role,
        item.use || "",
        ...item.categories,
        item.region,
        ...item.domains.map((id) => domainMap[id]?.name || id),
        ...exhibitions,
        ...item.exhibitions.map((record) => record.booth),
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      const sourceMatch = source.value.startsWith("event:")
        ? exhibitions.includes(source.value.slice(6))
        : sourceIds.includes(source.value);
      return (
        (activeView === "verified"
          ? isAccessibleOfficial(item)
          : !isAccessibleOfficial(item)) &&
        (!keyword || text.includes(keyword)) &&
        (!domain.value || item.domains.includes(domain.value)) &&
        (!role.value || item.role === role.value) &&
        (!region.value || regionBucket(item) === region.value) &&
        (!source.value || sourceMatch)
      );
    }).sort(stableDirectoryOrder);
    currentPage = 1;
    const verifiedTotal = companies.filter(
      (item) => item.verification === "verified_official" && item.url,
    ).length;
    const accessibleTotal = companies.filter(
      isAccessibleOfficial,
    ).length;
    const pendingTotal = companies.length - accessibleTotal;
    count.textContent = `当前结果 ${lastFiltered.length} 条；总库 ${companies.length} 条，已核官网 ${verifiedTotal} 条（当前可访问 ${accessibleTotal} 条），待核或不可达 ${pendingTotal} 条；每页 ${pageSize} 条`;
    empty.hidden = lastFiltered.length !== 0;
    renderPage();
  };

  [search, domain, role, region, source].forEach((element) =>
    element.addEventListener(element === search ? "input" : "change", render),
  );
  const switchView = (nextView) => {
    activeView = nextView;
    verifiedView.setAttribute(
      "aria-selected",
      String(activeView === "verified"),
    );
    pendingView.setAttribute(
      "aria-selected",
      String(activeView === "pending"),
    );
    render();
  };
  verifiedView.addEventListener("click", () => switchView("verified"));
  pendingView.addEventListener("click", () => switchView("pending"));
  reset.addEventListener("click", () => {
    [search, domain, role, region, source].forEach(
      (element) => (element.value = ""),
    );
    switchView("verified");
    search.focus();
  });
  previous.addEventListener("click", () => {
    currentPage -= 1;
    renderPage();
    count.scrollIntoView({ block: "nearest" });
  });
  next.addEventListener("click", () => {
    currentPage += 1;
    renderPage();
    count.scrollIntoView({ block: "nearest" });
  });
  render();
})();
