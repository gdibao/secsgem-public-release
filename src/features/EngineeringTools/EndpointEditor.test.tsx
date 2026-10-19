import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import EndpointEditor from './EndpointEditor';
import type { EngineeringEndpoint } from './workspaceTypes';

const endpoint: EngineeringEndpoint = {
  id: 'endpoint', toolId: 'EXAMPLE', mode: 'external_web', title: 'Official', url: 'https://example.com/work',
  authPrerequisite: '', licenseState: 'pending', licenseEvidence: null, embedEvidence: null, hostedEvidence: null,
  enabled: false, version: 5,
};

describe('EndpointEditor', () => {
  it('starts new endpoints disabled and pending and saves through the typed contract', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({});
    render(<EndpointEditor tools={[{ id: 'EXAMPLE', name: 'Example' }]} onCancel={vi.fn()} onSave={save} />);
    await user.click(screen.getByRole('combobox', { name: '关联工具' }));
    await user.click(screen.getByRole('option', { name: 'Example · EXAMPLE' }));
    fireEvent.change(screen.getByLabelText('端点名称'), { target: { value: 'Official' } });
    fireEvent.change(screen.getByLabelText('工作 URL（HTTPS）'), { target: { value: 'https://example.com/work' } });
    fireEvent.click(screen.getByRole('button', { name: '保存端点' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'external_web', enabled: false, licenseState: 'pending', licenseEvidence: null })));
  });

  it.each([
    ['工作区嵌入', '厂商嵌入许可证据 URL', 'embedded_web'],
    ['企业托管服务', '部署与再分发权利证据 URL', 'hosted_web'],
  ])('exposes the %s evidence controls without granting permission', async (label, evidenceLabel, mode) => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({});
    render(<EndpointEditor endpoint={endpoint} tools={[{ id: 'EXAMPLE', name: 'Example' }]} onCancel={vi.fn()} onSave={save} />);
    await user.click(screen.getByRole('combobox', { name: '接入方式' }));
    await user.click(screen.getByRole('option', { name: label }));
    expect(screen.getByLabelText(evidenceLabel)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存端点' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'endpoint', expectedVersion: 5, mode, licenseState: 'pending', enabled: false })));
  });
});
