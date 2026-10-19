import {
  Bell,
  Bot,
  Boxes,
  ChartNoAxesColumnIncreasing,
  Coins,
  Compass,
  FileText,
  Image,
  Library,
  ListTodo,
  type LucideIcon,
  MessageSquareMore,
  Palette,
  Pin,
  Plus,
  Presentation,
  Search,
  Settings,
  Shapes,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';

import type { MOBILE_ICON_NAMES } from '@/const/mobileConfig';

const iconMap: Record<(typeof MOBILE_ICON_NAMES)[number], LucideIcon> = {
  'bell': Bell,
  'bot': Bot,
  'boxes': Boxes,
  'chart-no-axes-column-increasing': ChartNoAxesColumnIncreasing,
  'coins': Coins,
  'compass': Compass,
  'file-text': FileText,
  'image': Image,
  'library': Library,
  'list-todo': ListTodo,
  'message-square-more': MessageSquareMore,
  'palette': Palette,
  'pin': Pin,
  'plus': Plus,
  'presentation': Presentation,
  'search': Search,
  'settings': Settings,
  'shapes': Shapes,
  'sparkles': Sparkles,
  'store': Store,
  'users': Users,
};

export const getMobileIcon = (name: string): LucideIcon =>
  iconMap[name as keyof typeof iconMap] ?? Shapes;
