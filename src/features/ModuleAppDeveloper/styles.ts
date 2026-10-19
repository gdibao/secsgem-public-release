import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  `,
  appHeader: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;

    @media (width < 640px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  empty: css`
    padding-block: 40px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  error: css`
    color: ${cssVar.colorError};
  `,
  field: css`
    display: grid;
    gap: 6px;
    max-width: 480px;
  `,
  frame: css`
    display: flex;
    flex-direction: column;
    gap: 20px;

    box-sizing: border-box;
    width: 100%;
    max-width: 1200px;
    margin-inline: auto;
    padding: 16px;

    @media (width >= 768px) {
      padding: 24px;
    }
  `,
  heading: css`
    margin: 0;
    font-size: 20px;
    line-height: 28px;
  `,
  label: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  metricGrid: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid ${cssVar.colorBorderSecondary};

    @media (width < 720px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  metric: css`
    min-width: 0;
    padding-block: 14px;
    padding-inline: 16px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-inline-end: 0;
    }

    @media (width < 720px) {
      &:nth-child(2) {
        border-inline-end: 0;
      }

      &:nth-child(-n + 2) {
        border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      }
    }
  `,
  metricValue: css`
    font-size: 22px;
    font-weight: 600;
    line-height: 30px;
  `,
  muted: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  notice: css`
    padding-block: 12px;
    padding-inline: 14px;
    border-inline-start: 3px solid ${cssVar.colorWarning};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorWarningBg};
  `,
  row: css`
    display: grid;
    gap: 10px;
    padding-block: 14px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }
  `,
  section: css`
    display: grid;
    gap: 14px;
  `,
  sectionHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  `,
  status: css`
    display: inline-flex;
    align-items: center;
    align-self: start;

    width: fit-content;
    padding-block: 2px;
    padding-inline: 7px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  statusBad: css`
    color: ${cssVar.colorError};
    background: ${cssVar.colorErrorBg};
  `,
  statusGood: css`
    color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccessBg};
  `,
  subgrid: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px 16px;

    @media (width < 720px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `,
  title: css`
    margin: 0;
    font-size: 15px;
    line-height: 22px;
    overflow-wrap: anywhere;
  `,
  versionList: css`
    margin-block-start: 2px;
    padding-inline-start: 14px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
  `,
}));
