'use client';

import type { RouteObject } from 'react-router';

import { dynamicElement, dynamicLayout, ErrorBoundary, redirectElement } from '@/utils/router';

type MobileWorkspaceRouteOptions = {
  includeDeveloper: boolean;
  labelPrefix: string;
};

export const createMobileWorkspaceFeatureRoutes = ({
  includeDeveloper,
  labelPrefix,
}: MobileWorkspaceRouteOptions): RouteObject[] => {
  const label = (name: string) => `${labelPrefix} > ${name}`;

  const appChildren: RouteObject[] = [
    {
      element: dynamicElement(() => import('@/routes/(mobile)/apps'), label('Apps')),
      index: true,
    },
    {
      children: [
        {
          element: dynamicElement(() => import('@/routes/(main)/apps'), label('Apps > Market')),
          index: true,
        },
      ],
      element: dynamicLayout(
        () => import('@/features/MobileWorkspace/MobileDeepPageGuard'),
        label('Apps > Market Guard'),
      ),
      path: 'market',
    },
  ];

  if (includeDeveloper) {
    appChildren.push({
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/apps/developer'),
            label('Apps > Developer'),
          ),
          index: true,
        },
      ],
      element: dynamicLayout(
        () => import('@/features/MobileWorkspace/MobileDeepPageGuard'),
        label('Apps > Developer Guard'),
      ),
      path: 'developer',
    });
  }

  appChildren.push({
    children: [
      {
        element: dynamicElement(
          () => import('@/routes/(main)/apps/[appId]'),
          label('Apps > Detail'),
        ),
        index: true,
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/apps/[appId]/app'),
          label('Apps > Runtime'),
        ),
        path: 'app',
      },
      {
        element: dynamicElement(
          () => import('@/routes/(main)/apps/[appId]/app/[pageKey]'),
          label('Apps > Runtime Page'),
        ),
        path: 'app/:pageKey',
      },
    ],
    element: dynamicLayout(
      () => import('@/features/MobileWorkspace/MobileDeepPageGuard'),
      label('Apps > Detail Guard'),
    ),
    path: ':appId',
  });

  return [
    {
      element: dynamicElement(
        () => import('@/routes/(main)/engineering-tools'),
        label('Engineering Tools'),
      ),
      path: 'engineering-tools',
    },
    {
      element: dynamicElement(() => import('@/routes/(mobile)/design'), label('Design')),
      path: 'design',
    },
    {
      children: [
        {
          element: redirectElement('..'),
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/page/[id]'),
            label('Page > Detail'),
          ),
          path: ':id',
        },
      ],
      element: dynamicLayout(
        () =>
          import('@/routes/(main)/page/_layout').then(({ MobilePagesLayout }) => ({
            default: MobilePagesLayout,
          })),
        label('Pages > Mobile Layout'),
      ),
      errorElement: <ErrorBoundary />,
      path: 'page',
    },
    {
      children: [
        {
          children: [
            {
              element: dynamicElement(
                () =>
                  import('@/routes/(main)/(create)/image').then(({ MobileImagePage }) => ({
                    default: MobileImagePage,
                  })),
                label('Image'),
              ),
              index: true,
            },
          ],
          element: dynamicLayout(
            () => import('@/routes/(main)/(create)/image/_layout'),
            label('Image > Layout'),
          ),
        },
      ],
      element: dynamicLayout(
        () => import('@/features/MobileWorkspace/MobileDeepPageGuard'),
        label('Image > Deep Page Guard'),
      ),
      errorElement: <ErrorBoundary />,
      path: 'image',
    },
    {
      children: [
        {
          element: dynamicElement(
            () =>
              import('@/routes/(main)/(create)/ppt').then(({ MobilePptPage }) => ({
                default: MobilePptPage,
              })),
            label('PPT'),
          ),
          index: true,
        },
      ],
      element: dynamicLayout(
        () => import('@/features/MobileWorkspace/MobileDeepPageGuard'),
        label('PPT > Deep Page Guard'),
      ),
      errorElement: <ErrorBoundary />,
      path: 'ppt',
    },
    {
      element: dynamicElement(() => import('@/routes/(mobile)/discover'), label('Discover')),
      path: 'discover',
    },
    {
      children: appChildren,
      errorElement: <ErrorBoundary />,
      path: 'apps',
    },
  ];
};
