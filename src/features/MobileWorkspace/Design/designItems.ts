import type { MobileDesignToolV1 } from '@/const/mobileConfig';

export interface MobileDesignTool extends MobileDesignToolV1 {
  routePath: string;
}

const createPaths: Record<MobileDesignToolV1['id'], string> = {
  document: '/page',
  image: '/image',
  ppt: '/ppt',
};

export const buildMobileDesignTools = (tools: MobileDesignToolV1[]): MobileDesignTool[] =>
  tools
    .filter((tool) => tool.enabled)
    .sort((left, right) => left.order - right.order)
    .map((tool) => ({ ...tool, routePath: createPaths[tool.id] }));

export const getDesignKindLabel = (kind: 'document' | 'image' | 'ppt') => {
  switch (kind) {
    case 'document': {
      return 'Document';
    }
    case 'image': {
      return 'Image';
    }
    case 'ppt': {
      return 'PPT';
    }
  }
};
