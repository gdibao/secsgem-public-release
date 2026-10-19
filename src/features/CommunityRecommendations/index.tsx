'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Tag, Typography } from 'antd';
import { memo, type ReactNode } from 'react';
import { Link } from 'react-router';

import { useClientDataSWR } from '@/libs/swr';
import AssistantList from '@/routes/(main)/community/(list)/agent/features/List';
import McpList from '@/routes/(main)/community/(list)/mcp/features/List';
import SkillList from '@/routes/(main)/community/(list)/skill/features/List';
import { adminCommercialService } from '@/services/adminCommercial';
import { useDiscoverStore } from '@/store/discover';
import { AssistantSorts, McpSorts, SkillSorts } from '@/types/discover';

const normalizeSkillSort = (value?: string): SkillSorts => {
  if (value && Object.values(SkillSorts).includes(value as SkillSorts)) return value as SkillSorts;

  return SkillSorts.InstallCount;
};

const Section = memo<{
  children: ReactNode;
  moreLink: string;
  title: string;
}>(({ children, moreLink, title }) => (
  <Flexbox gap={12}>
    <Flexbox horizontal align="center" distribution="space-between">
      <Typography.Title level={3} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      <Link to={moreLink}>
        <Button type="link">更多</Button>
      </Link>
    </Flexbox>
    {children}
  </Flexbox>
));

Section.displayName = 'CommunityRecommendationSection';

const RecommendationContent = memo<{
  config: Awaited<ReturnType<typeof adminCommercialService.getPublicRecommendations>>;
}>(({ config }) => {
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const assistantCategory = config.assistantTags[0] || config.selectedTags[0] || undefined;
  const mcpCategory = config.mcpCategories[0] || undefined;
  const skillCategory = config.skillCategories[0] || undefined;
  const generalSkillCategory = config.generalSkillCategories[0] || undefined;
  const skillSort = normalizeSkillSort(config.hotSkillSort);

  const { data: assistants, isLoading: assistantLoading } = useAssistantList({
    category: assistantCategory,
    page: 1,
    pageSize: 8,
    sort: AssistantSorts.Recommended,
  });
  const { data: mcps, isLoading: mcpLoading } = useMcpList({
    category: mcpCategory,
    page: 1,
    pageSize: 8,
    sort: McpSorts.Recommended,
  });
  const { data: skills, isLoading: skillLoading } = useSkillList({
    category: skillCategory,
    page: 1,
    pageSize: 8,
    sort: SkillSorts.InstallCount,
  });
  const { data: generalSkills, isLoading: generalSkillLoading } = useSkillList({
    category: generalSkillCategory,
    page: 1,
    pageSize: 8,
    sort: SkillSorts.InstallCount,
  });
  const { data: hotSkills, isLoading: hotSkillLoading } = useSkillList({
    page: 1,
    pageSize: 8,
    sort: skillSort,
  });

  const loading =
    assistantLoading || mcpLoading || skillLoading || generalSkillLoading || hotSkillLoading;
  const hasAnyData =
    (config.assistantsEnabled && (assistants?.items?.length ?? 0) > 0) ||
    (config.mcpsEnabled && (mcps?.items?.length ?? 0) > 0) ||
    (config.skillsEnabled && (skills?.items?.length ?? 0) > 0) ||
    (config.generalSkillsEnabled && (generalSkills?.items?.length ?? 0) > 0) ||
    (config.hotSkillsEnabled && (hotSkills?.items?.length ?? 0) > 0);

  if (loading && !hasAnyData) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (!hasAnyData) return null;

  return (
    <Flexbox gap={24}>
      {config.selectedTags.length > 0 && (
        <Flexbox horizontal gap={8} wrap="wrap">
          {config.selectedTags.map((tag) => (
            <Tag color="blue" key={tag}>
              {tag}
            </Tag>
          ))}
        </Flexbox>
      )}
      {config.assistantsEnabled && (assistants?.items?.length ?? 0) > 0 && (
        <Section moreLink="/community/agent" title={config.assistantTitle || '为你推荐的助理'}>
          <AssistantList data={assistants?.items} rows={4} />
        </Section>
      )}
      {config.mcpsEnabled && (mcps?.items?.length ?? 0) > 0 && (
        <Section moreLink="/community/mcp" title={config.mcpTitle || '推荐 MCP / 工具'}>
          <McpList data={mcps?.items} rows={4} />
        </Section>
      )}
      {config.skillsEnabled && (skills?.items?.length ?? 0) > 0 && (
        <Section moreLink="/community/skill" title={config.skillTitle || '推荐技能'}>
          <SkillList data={skills?.items} rows={4} />
        </Section>
      )}
      {config.generalSkillsEnabled && (generalSkills?.items?.length ?? 0) > 0 && (
        <Section moreLink="/community/skill" title={config.generalSkillTitle || '通用推荐技能'}>
          <SkillList data={generalSkills?.items} rows={4} />
        </Section>
      )}
      {config.hotSkillsEnabled && (hotSkills?.items?.length ?? 0) > 0 && (
        <Section moreLink="/community/skill" title={config.hotSkillTitle || '热门技能'}>
          <SkillList data={hotSkills?.items} rows={4} />
        </Section>
      )}
    </Flexbox>
  );
});

RecommendationContent.displayName = 'CommunityRecommendationContent';

const CommunityRecommendations = memo(() => {
  const { data, isLoading } = useClientDataSWR(['public-recommendations'], () =>
    adminCommercialService.getPublicRecommendations(),
  );

  const enabled = data?.enabled;

  if (isLoading) return null;
  if (!enabled || !data) return null;

  return <RecommendationContent config={data} />;
});

CommunityRecommendations.displayName = 'CommunityRecommendations';

export default CommunityRecommendations;
