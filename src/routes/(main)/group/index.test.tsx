import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({
  conversation: vi.fn(),
  portal: vi.fn(),
  telemetry: vi.fn(),
}));

vi.mock('./features/Conversation', () => ({
  default: (props: unknown) => {
    rendered.conversation(props);
    return null;
  },
}));

vi.mock('./features/Portal', () => ({
  default: (props: unknown) => {
    rendered.portal(props);
    return null;
  },
}));

vi.mock('./features/TelemetryNotification', () => ({
  default: (props: unknown) => {
    rendered.telemetry(props);
    return null;
  },
}));

import ChatPage from './index';

describe('GroupChatPage', () => {
  it('forwards mobile mode to every group conversation surface', () => {
    render(<ChatPage mobile />);

    expect(rendered.conversation).toHaveBeenCalledWith({ mobile: true });
    expect(rendered.portal).toHaveBeenCalledWith({ mobile: true });
    expect(rendered.telemetry).toHaveBeenCalledWith({ mobile: true });
  });
});
