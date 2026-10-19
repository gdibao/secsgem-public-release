import { createStaticStyles, cssVar } from 'antd-style';

export const mobileSettingsStyles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  `,
  itemRow: css`
    display: grid;
    grid-template-columns: minmax(130px, 1fr) minmax(130px, 1fr) minmax(140px, 1fr) auto auto;
    gap: 8px;
    align-items: end;

    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    @media (width <= 900px) {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    @media (width <= 560px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  orderedEntry: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-height: 40px;
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  sectionTitle: css`
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  `,
}));
