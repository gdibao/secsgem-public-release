'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Tooltip } from 'antd';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const CursorPager = ({
  hasNext,
  hasPrevious,
  nextLabel = 'Next page',
  onNext,
  onPrevious,
  previousLabel = 'Previous page',
}: {
  hasNext?: boolean;
  hasPrevious?: boolean;
  nextLabel?: string;
  onNext?: () => void;
  onPrevious?: () => void;
  previousLabel?: string;
}) => (
  <Flexbox horizontal gap={6} justify="flex-end">
    <Tooltip title={previousLabel}>
      <Button
        aria-label={previousLabel}
        disabled={!hasPrevious}
        icon={<Icon icon={ChevronLeft} size={16} />}
        style={{ height: 32, width: 32 }}
        onClick={onPrevious}
      />
    </Tooltip>
    <Tooltip title={nextLabel}>
      <Button
        aria-label={nextLabel}
        disabled={!hasNext}
        icon={<Icon icon={ChevronRight} size={16} />}
        style={{ height: 32, width: 32 }}
        onClick={onNext}
      />
    </Tooltip>
  </Flexbox>
);

export default CursorPager;
