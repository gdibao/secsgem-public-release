'use client';

import { Button } from '@lobehub/ui';
import { ArrowRight, Bot, Brain, Boxes, Cable, Cpu, Shapes } from 'lucide-react';
import { useNavigate } from 'react-router';

import { localCapabilitySummary } from './catalog';
import { styles } from './style';

const cards = [
  { icon: Shapes, path: '/community/agent', title: '本地助手市场', text: '195 个 Fab 助手，按 18 域、岗位和厂商筛选。' },
  { icon: Bot, path: '/community/skill', title: '本地技能市场', text: `${localCapabilitySummary.skillPackages} 个 FAB 工程技能包，以及每日同步的精选清单。` },
  { icon: Cable, path: '/community/mcp', title: '本地 MCP 市场', text: '本地知识库、OnlyBoxes 沙箱和精选 MCP 清单。' },
  { icon: Brain, path: '/community/model', title: '本地模型市场', text: '展示 Fab 当前允许的模型别名和能力边界。' },
  { icon: Cpu, path: '/community/provider', title: '本地模型供应商市场', text: '展示当前站点实际配置的模型供应商。' },
  { icon: Boxes, path: '/community/agent', title: 'Fab 能力总览', text: `${localCapabilitySummary.domains} 个域、${localCapabilitySummary.roles} 个角色、${localCapabilitySummary.toolPackages} 个工具包。` },
];

const LocalMarketOverview = () => {
  const navigate = useNavigate();

  return (
    <main className={styles.page} data-testid="local-market-overview">
      <div className={styles.header}>
        <div>
          <h1>本地市场</h1>
          <div className={styles.meta}>驰拓 AI 的离线助手、技能、MCP、模型和供应商目录。</div>
        </div>
      </div>
      <div className={styles.cardGrid}>
        {cards.map(({ icon: Icon, path, text, title }) => (
          <article className={styles.card} key={path + title}>
            <Icon size={26} />
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.description}>{text}</p>
            <Button icon={ArrowRight} size="small" onClick={() => navigate(path)}>
              打开市场
            </Button>
          </article>
        ))}
      </div>
    </main>
  );
};

export default LocalMarketOverview;
