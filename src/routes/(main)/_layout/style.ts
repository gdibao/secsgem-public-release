import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Main container - non-PWA mode (no top border)
  mainContainer: css`
    position: relative;

    @media (max-width: 759px) {
      &:has([data-engineering-tools-page]) > aside.base-draggable-panel {
        position: absolute;
        inset: 0 auto 0 0;
      }

      &:has([data-engineering-tools-page]) > aside.base-draggable-panel[data-expand='false'] {
        pointer-events: none;
      }
    }
  `,

  // Main container - PWA mode (with top border)
  mainContainerPWA: css`
    position: relative;
    border-block-start: 1px solid ${cssVar.colorBorder};

    @media (max-width: 759px) {
      &:has([data-engineering-tools-page]) > aside.base-draggable-panel {
        position: absolute;
        inset: 0 auto 0 0;
      }

      &:has([data-engineering-tools-page]) > aside.base-draggable-panel[data-expand='false'] {
        pointer-events: none;
      }
    }
  `,
}));
