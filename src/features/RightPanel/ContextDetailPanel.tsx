'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { Maximize2, Minimize2 } from 'lucide-react';
import { type ReactNode } from 'react';

import NavHeader from '@/features/NavHeader';
import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import RightPanel, { type Size } from './index';
import ToggleRightPanelButton from './ToggleRightPanelButton';

interface ContextDetailPanelProps {
  children: ReactNode;
  defaultWidth?: number;
  fullWidth?: boolean;
  maxWidth?: number;
  minWidth?: number;
  onFullWidthChange?: (fullWidth: boolean) => void;
  onSizeChange?: (size?: Size) => void;
  title: string;
  width?: number;
}

export const ContextDetailToggle = ({ title }: { title: string }) => {
  const expanded = useGlobalStore(systemStatusSelectors.showRightPanel);
  return expanded ? null : <ToggleRightPanelButton controlsId="context_detail_panel" title={`显示${title}`} />;
};

const ContextDetailPanel = ({ children, defaultWidth = 360, fullWidth = false, maxWidth = 520, minWidth = 300, onFullWidthChange, onSizeChange, title, width }: ContextDetailPanelProps) => {
  const [expanded, toggle] = useGlobalStore((state) => [
    systemStatusSelectors.showRightPanel(state),
    state.toggleRightPanel,
  ]);
  const { mobile } = useResponsive();

  if (mobile || fullWidth) {
    return (
      <Drawer
        open={expanded}
        width="100%"
        title={<Flexbox horizontal align="center" gap={8}>
          {mobile && <ToggleLeftPanelButton forceExpand forceVisible id="context_detail_mobile_left_toggle" onToggle={() => toggle(false)} />}
          <span>{title}</span>
          {!mobile && <Button aria-label="退出全宽" icon={<Minimize2 size={16} />} title="退出全宽" onClick={() => onFullWidthChange?.(false)} />}
        </Flexbox>}
        onClose={() => { toggle(false); onFullWidthChange?.(false); }}
      >
        {expanded && <div id="context_detail_panel">{children}</div>}
      </Drawer>
    );
  }

  return (
    <RightPanel defaultWidth={defaultWidth} expand={expanded} maxWidth={maxWidth} minWidth={minWidth} width={width} onExpandChange={toggle} onSizeChange={onSizeChange}>
      {expanded && <Flexbox height="100%" style={{ minHeight: 0 }}>
        <NavHeader
          left={<strong>{title}</strong>}
          showTogglePanelButton={false}
          right={<Flexbox horizontal gap={4}>
            {onFullWidthChange && <Button aria-label="全宽显示工具" icon={<Maximize2 size={16} />} title="全宽显示工具" onClick={() => onFullWidthChange(true)} />}
            <ToggleRightPanelButton controlsId="context_detail_panel" title={`收起${title}`} />
          </Flexbox>}
        />
        <div id="context_detail_panel" style={{ flex: 1, overflow: 'auto', padding: 16 }}>{children}</div>
      </Flexbox>}
    </RightPanel>
  );
};

export default ContextDetailPanel;
