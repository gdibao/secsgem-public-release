import { Icon, type MenuProps } from '@lobehub/ui';
import { DiscordIcon, GithubIcon } from '@lobehub/ui/icons';
import {
  Book,
  CircleHelp,
  Feather,
  FileClockIcon,
  FlaskConical,
  MessageCircle,
  Rocket,
  Settings2,
} from 'lucide-react';
import { Link } from 'react-router';

import { type HelpMenuIcon, type HelpMenuItem } from '@/const/helpMenu';

type HelpMenuHandlers = {
  onChangelog: () => void;
  onFeedback: () => void;
  onProductHunt: () => void;
};

const iconMap: Record<HelpMenuIcon, any> = {
  book: Book,
  discord: DiscordIcon,
  feather: Feather,
  'file-clock': FileClockIcon,
  flask: FlaskConical,
  github: GithubIcon,
  help: CircleHelp,
  message: MessageCircle,
  rocket: Rocket,
  settings: Settings2,
};

const isInternalUrl = (url: string) => url.startsWith('/');

const createLinkLabel = (label: string, url?: string) => {
  if (!url) return label;

  return isInternalUrl(url) ? (
    <Link to={url}>{label}</Link>
  ) : (
    <a href={url} rel="noopener noreferrer" target="_blank">
      {label}
    </a>
  );
};

const createMenuIcon = (icon: HelpMenuIcon) => <Icon icon={iconMap[icon] || CircleHelp} />;

export const createConfiguredHelpMenuItems = (
  items: HelpMenuItem[],
  handlers: HelpMenuHandlers,
): MenuProps['items'] =>
  items.map((item) => {
    const base = {
      icon: createMenuIcon(item.icon),
      key: item.key,
    };

    if (item.url) {
      return {
        ...base,
        label: createLinkLabel(item.label, item.url),
      };
    }

    switch (item.action) {
      case 'feedback': {
        return {
          ...base,
          label: item.label,
          onClick: handlers.onFeedback,
        };
      }
      case 'changelog': {
        return {
          ...base,
          label: item.label,
          onClick: handlers.onChangelog,
        };
      }
      case 'settings': {
        return {
          ...base,
          label: createLinkLabel(item.label, item.url || '/settings'),
        };
      }
      case 'eval': {
        return {
          ...base,
          label: createLinkLabel(item.label, item.url || '/eval'),
        };
      }
      case 'product-hunt': {
        return {
          ...base,
          label: item.label,
          onClick: handlers.onProductHunt,
        };
      }
      default: {
        return {
          ...base,
          label: createLinkLabel(item.label, item.url),
        };
      }
    }
  });
