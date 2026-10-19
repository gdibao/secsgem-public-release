import { createStaticStyles } from 'antd-style';

export const workspaceStyles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    min-width: 0;
    overflow: auto;
    padding: 16px 28px 32px;
    overflow-wrap: anywhere;
    @media (width < 760px) { padding: 12px 16px 24px; }
    @container (width < 760px) { padding: 12px 16px 24px; }
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding-block: 8px;
    > * { min-width: 0; max-width: 100%; }
    button { white-space: normal; overflow-wrap: anywhere; }
  `,
  editor: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding-block: 16px;
    border-block: 1px solid ${cssVar.colorBorderSecondary};
    > * { min-width: 0; }
    @media (width < 760px) { grid-template-columns: minmax(0, 1fr); }
    @container (width < 760px) { grid-template-columns: minmax(0, 1fr); }
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    overflow-wrap: anywhere;
    input { min-width: 0; width: 100%; }
  `,
  full: css`grid-column: 1 / -1; min-width: 0;`,
  row: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding-block: 12px;
    border-bottom: 1px solid ${cssVar.colorBorderSecondary};
    > * { min-width: 0; max-width: 100%; }
    strong { overflow-wrap: anywhere; }
  `,
  muted: css`color: ${cssVar.colorTextSecondary}; font-size: 12px; overflow-wrap: anywhere;`,
  frame: css`
    display: block;
    width: 100%;
    min-width: 0;
    height: max(480px, 65dvh);
    border: 1px solid ${cssVar.colorBorderSecondary};
    /* L2-1 / ui-ux-spec A1-4: mobile (<760px) keeps the frame usable in a
       full-height drawer without page-level double scrolling. */
    @media (width < 760px) { height: max(420px, 80dvh); }
  `,
}));
