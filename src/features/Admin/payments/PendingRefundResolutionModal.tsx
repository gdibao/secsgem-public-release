'use client';

import { Modal, Select, TextArea } from '@lobehub/ui/base-ui';
import { Alert } from 'antd';
import { createStaticStyles } from 'antd-style';

const styles = createStaticStyles(({ css }) => ({
  field: css`
    display: grid;
    gap: 6px;
  `,
  form: css`
    display: grid;
    gap: 12px;
  `,
}));

export type PendingRefundResolution = 'failed' | 'succeeded';

type PendingRefundResolutionModalProps = {
  busy: boolean;
  labels: {
    cancel: string;
    chooseOutcome: string;
    confirm: string;
    description: string;
    note: string;
    notRefunded: string;
    outcome: string;
    refunded: string;
  };
  note: string;
  open: boolean;
  resolution?: PendingRefundResolution;
  summary: string;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  onNoteChange: (value: string) => void;
  onResolutionChange: (value: PendingRefundResolution) => void;
};

const PendingRefundResolutionModal = (props: PendingRefundResolutionModalProps) => (
  <Modal
    cancelButtonProps={{ disabled: props.busy }}
    cancelText={props.labels.cancel}
    confirmLoading={props.busy}
    okButtonProps={{ disabled: props.busy || !props.resolution || !props.note.trim() }}
    okText={props.labels.confirm}
    open={props.open}
    title={props.title}
    onCancel={props.onCancel}
    onOk={props.onConfirm}
  >
    <div className={styles.form}>
      <Alert showIcon message={props.labels.description} type="warning" />
      <div>{props.summary}</div>
      <label className={styles.field}>
        {props.labels.outcome}
        <Select
          disabled={props.busy}
          placeholder={props.labels.chooseOutcome}
          value={props.resolution}
          options={[
            { label: props.labels.refunded, value: 'succeeded' },
            { label: props.labels.notRefunded, value: 'failed' },
          ]}
          onChange={(value) => props.onResolutionChange(value as PendingRefundResolution)}
        />
      </label>
      <label className={styles.field}>
        {props.labels.note}
        <TextArea
          required
          disabled={props.busy}
          maxLength={500}
          value={props.note}
          onChange={(event) => props.onNoteChange(event.target.value)}
        />
      </label>
    </div>
  </Modal>
);

export default PendingRefundResolutionModal;
