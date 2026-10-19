import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  capabilityAction: css`
    flex: none;
  `,
  capabilityBody: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  capabilityCard: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};

    button:disabled {
      border-color: ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
      opacity: 1;
    }
  `,
  capabilityGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 10px;
    overflow: auto;
    max-height: 52vh;
  `,
  capabilityStore: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgElevated};
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 184px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};

    button:disabled {
      border-color: ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
      opacity: 1;
    }
  `,
  cardGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 12px;
  `,
  description: css`
    min-height: 42px;
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
    line-height: 1.55;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-block-end: 16px;
  `,
  meta: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
  marketNotice: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-block: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  pagination: css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-block: 20px;
  `,
  page: css`
    overflow: auto;
    height: 100%;
    padding: 28px;
  `,
  sourceTab: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
    padding: 6px 12px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
    cursor: pointer;
    &:hover {
      border-color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  sourceTabActive: css`
    border: 1px solid ${cssVar.colorText};
    border-radius: 6px;
    padding: 6px 12px;
    color: ${cssVar.colorText};
    font-weight: 600;
    background: ${cssVar.colorFillSecondary};
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  sourceTabs: css`
    display: flex;
    gap: 8px;
    margin-block-end: 16px;
  `,
  tag: css`
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: 999px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillTertiary};
    font-size: 12px;
  `,
  title: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  `,
}));
