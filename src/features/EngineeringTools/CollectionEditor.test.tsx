import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ordered } from './collectionEditing';
import CollectionEditor from './CollectionEditor';
import type { CollectionWrite, EngineeringCollection } from './workspaceTypes';

vi.mock('./EndpointPreference', () => ({ default: () => <span>Endpoint preference</span> }));

const collection: EngineeringCollection = {
  id: 'collection', ownerId: 'owner', workspaceId: null, version: 3, sortOrder: 0, name: 'Personal',
  groups: [{ id: 'a', name: 'A', sortOrder: 0 }, { id: 'b', name: 'B', sortOrder: 1 }],
  entries: [
    { toolId: 'EXAMPLE', groupId: 'a', alias: 'First', defaultEndpointId: null, sortOrder: 0 },
    { toolId: 'EXAMPLE', groupId: 'b', alias: 'Second', defaultEndpointId: null, sortOrder: 1 },
  ],
};

describe('CollectionEditor', () => {
  it('saves the visible order within a group when another group is interleaved', async () => {
    const save = vi.fn().mockResolvedValue({});
    const grouped = {
      ...collection,
      entries: [
        { toolId: 'A', groupId: 'a', alias: null, defaultEndpointId: null, sortOrder: 0 },
        { toolId: 'B', groupId: 'b', alias: null, defaultEndpointId: null, sortOrder: 1 },
        { toolId: 'C', groupId: 'a', alias: null, defaultEndpointId: null, sortOrder: 2 },
      ],
    };
    render(<CollectionEditor collection={grouped} tools={['A', 'B', 'C'].map((id) => ({ id, name: id }))} onCancel={vi.fn()} onSave={save} />);
    expect(screen.getByRole('button', { name: '上移收藏 B' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上移收藏 C' }));
    fireEvent.click(screen.getByRole('button', { name: '保存收藏夹' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const saved = save.mock.calls[0][0] as CollectionWrite;
    expect(ordered(saved.entries).filter((entry) => entry.groupId === 'a').map((entry) => entry.toolId)).toEqual(['C', 'A']);
    expect(ordered(saved.entries).filter((entry) => entry.groupId === 'b').map((entry) => entry.toolId)).toEqual(['B']);
  });
  it('edits and removes just one copy of a tool in two groups, then writes the CAS version', async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<CollectionEditor collection={collection} tools={[{ id: 'EXAMPLE', name: 'Example' }]} onCancel={vi.fn()} onSave={save} />);
    const rows = screen.getAllByRole('region', { name: '编辑收藏 Example' });
    fireEvent.change(within(rows[0]).getByLabelText('EXAMPLE 别名'), { target: { value: 'Edited' } });
    expect(within(rows[1]).getByLabelText('EXAMPLE 别名')).toHaveValue('Second');
    fireEvent.click(within(rows[0]).getByRole('button', { name: '取消收藏 Example' }));
    fireEvent.click(screen.getByRole('button', { name: '保存收藏夹' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3, entries: [expect.objectContaining({ groupId: 'b', alias: 'Second' })],
    })));
  });

  it('retains the draft and reports conflicts without pretending that it saved', async () => {
    const save = vi.fn().mockRejectedValue({ data: { code: 'CONFLICT' } });
    render(<CollectionEditor collection={collection} tools={[]} onCancel={vi.fn()} onSave={save} />);
    fireEvent.change(screen.getByLabelText('收藏夹名称'), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: '保存收藏夹' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('版本冲突');
    expect(screen.getByLabelText('收藏夹名称')).toHaveValue('Unsaved');
  });
});
