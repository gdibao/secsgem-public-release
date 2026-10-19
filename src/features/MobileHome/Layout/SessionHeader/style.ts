import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  brandLogo: css`
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    object-fit: contain;
  `,
  brandName: css`
    overflow: hidden;

    max-width: 160px;

    font-size: 17px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  leftContainer: css`
    margin-inline-start: 8px;
  `,
}));
