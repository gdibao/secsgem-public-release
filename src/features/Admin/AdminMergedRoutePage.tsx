'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Alert } from 'antd';
import { memo } from 'react';
import { useNavigate } from 'react-router';

import { AdminPageShell, AdminSection } from './layout';

type MergedRouteAction = {
  label: string;
  path: string;
};

type AdminMergedRoutePageProps = {
  description: string;
  primaryAction: MergedRouteAction;
  secondaryAction?: MergedRouteAction;
  title: string;
};

const AdminMergedRoutePage = memo<AdminMergedRoutePageProps>(
  ({ description, primaryAction, secondaryAction, title }) => {
    const navigate = useNavigate();

    return (
      <AdminPageShell description={description} title={title} width="small">
        <Alert
          showIcon
          message="此旧入口不再提供独立保存表单，避免同一配置在多个页面被覆盖。"
          type="info"
        />
        <AdminSection description="继续前往当前负责该配置的管理页面。" title="配置入口">
          <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
            <Button type="primary" onClick={() => navigate(primaryAction.path)}>
              {primaryAction.label}
            </Button>
            {secondaryAction ? (
              <Button onClick={() => navigate(secondaryAction.path)}>
                {secondaryAction.label}
              </Button>
            ) : null}
          </Flexbox>
        </AdminSection>
      </AdminPageShell>
    );
  },
);

AdminMergedRoutePage.displayName = 'AdminMergedRoutePage';

export default AdminMergedRoutePage;
