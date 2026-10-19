export type ExpertPlazaCard = {
  author?: string;
  avatar?: string;
  category?: string;
  description: string;
  enabled: boolean;
  featured?: boolean;
  id: string;
  metricLabel?: string;
  metricValue?: string;
  tags: string[];
  title: string;
  url?: string;
};

export type ExpertPlazaConfig = {
  cards: ExpertPlazaCard[];
  categories: string[];
  description: string;
  enabled: boolean;
  name: string;
};

export const DEFAULT_EXPERT_PLAZA_CONFIG: ExpertPlazaConfig = {
  cards: [],
  categories: ['推荐', '办公', '创作', '编程', '学习'],
  description: '精选专家助手、工作流和服务入口',
  enabled: false,
  name: '专家广场',
};

const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeStringList = (value: unknown): string[] => {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => (typeof item === 'string' ? item.split(/[\r\n,;，；]+/) : []))
    : typeof value === 'string'
      ? value.split(/[\r\n,;，；]+/)
      : [];

  return Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean)));
};

export const normalizeExpertPlazaCards = (value: unknown): ExpertPlazaCard[] => {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const cards: ExpertPlazaCard[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const record = item as Record<string, unknown>;
    const title = normalizeString(record.title);
    const description = normalizeString(record.description);
    const fallbackId = title.toLowerCase().replaceAll(/\s+/g, '-');
    const id = normalizeString(record.id) || fallbackId;

    if (!id || !title || !description || seen.has(id)) continue;
    seen.add(id);

    cards.push({
      author: normalizeString(record.author) || undefined,
      avatar: normalizeString(record.avatar) || undefined,
      category: normalizeString(record.category) || undefined,
      description,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      featured: Boolean(record.featured),
      id,
      metricLabel: normalizeString(record.metricLabel) || undefined,
      metricValue: normalizeString(record.metricValue) || undefined,
      tags: normalizeStringList(record.tags).slice(0, 8),
      title,
      url: normalizeString(record.url) || undefined,
    });
  }

  return cards;
};

export const normalizeExpertPlazaConfig = (value: unknown): ExpertPlazaConfig => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const categories = normalizeStringList(record.categories).slice(0, 24);

  return {
    cards: normalizeExpertPlazaCards(record.cards),
    categories: categories.length > 0 ? categories : DEFAULT_EXPERT_PLAZA_CONFIG.categories,
    description: normalizeString(record.description) || DEFAULT_EXPERT_PLAZA_CONFIG.description,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : false,
    name: normalizeString(record.name) || DEFAULT_EXPERT_PLAZA_CONFIG.name,
  };
};
