import { type MetadataRoute } from 'next';

const manifest = async (): Promise<MetadataRoute.Manifest> => {
  // Skip heavy module compilation in development
  if (process.env.NODE_ENV === 'development') {
    return {
      background_color: '#000000',
      description: '驰拓 AI 助手开发环境',
      display: 'standalone',
      icons: [
        {
          sizes: '192x192',
          src: '/app-icons/icon-192x192.png',
          type: 'image/png',
        },
      ],
      name: '驰拓 AI 助手',
      short_name: '驰拓 AI 助手',
      start_url: '/',
      theme_color: '#000000',
    };
  }

  const [
    { BRANDING_NAME },
    { kebabCase },
    { manifestModule },
    { getServerBrand },
  ] = await Promise.all([
    import('@lobechat/business-const'),
    import('es-toolkit/compat'),
    import('@/libs/metadata/manifest'),
    import('@/server/services/brand'),
  ]);
  const brand = await getServerBrand();
  const appName = brand.name?.trim() || BRANDING_NAME;

  // @ts-expect-error - manifestModule.generate returns extended manifest with custom properties
  return manifestModule.generate({
    description: '面向半导体工程团队的私有化 AI 助手平台。',
    icons: [
      {
        purpose: 'any',
        sizes: '192x192',
        url: '/app-icons/icon-192x192.png',
      },
      {
        purpose: 'maskable',
        sizes: '192x192',
        url: '/app-icons/icon-192x192.maskable.png',
      },
      {
        purpose: 'any',
        sizes: '512x512',
        url: '/app-icons/icon-512x512.png',
      },
      {
        purpose: 'maskable',
        sizes: '512x512',
        url: '/app-icons/icon-512x512.maskable.png',
      },
    ],
    id: kebabCase(appName),
    name: appName,
    screenshots: [],
    short_name: appName,
  });
};

export default manifest;
