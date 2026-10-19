import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  filters: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 8px;
    margin-block: 12px;
    select {
      width: 100%;
      min-width: 0;
      height: 36px;
      padding: 4px 8px;
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: 6px;
      color: ${cssVar.colorText};
      background: ${cssVar.colorBgContainer};
    }
  `,
  page: css`
    overflow: auto;
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 20px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgLayout};
    box-sizing: border-box;
    @media (width < 600px) {
      padding: 12px;
    }
  `,
  header: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    margin-block-end: 16px;
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 28px;
    }
  `,
  tabs: css`
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    padding-block: 12px;
    margin-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: inherit;
    }
    [aria-current='page'] {
      color: ${cssVar.colorPrimary};
      font-weight: 600;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
    gap: 12px;
    margin-block-start: 16px;
  `,
  card: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
    overflow-wrap: anywhere;
    h2 {
      margin: 0;
      font-size: 16px;
      line-height: 24px;
    }
    p {
      margin: 0;
    }
    summary {
      cursor: pointer;
    }
    pre {
      white-space: pre-wrap;
      font: inherit;
      font-size: 13px;
      line-height: 1.7;
    }
    button {
      margin-block-start: auto;
    }
    button:disabled {
      border-color: ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
      opacity: 1;
    }
  `,
  meta: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
    line-height: 20px;
    overflow-wrap: anywhere;
  `,
  pagination: css`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-block: 20px;

    button:disabled {
      border-color: ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
      opacity: 1;
    }
  `,
}));
