import type { ModuleAppAdminUpsertInput, ModuleAppPlanEntitlement } from '@lobechat/types';

import {
  buildModuleAppUpsertInput,
  createDefaultModuleAppFormValues,
  type ModuleAppAdminFormInput,
  normalizeModuleAppFormValues,
} from '../formSchema';
import type { AdminModuleAppDetail } from '../types';

export type ModuleAppIdentityFormValues = Pick<
  ModuleAppAdminFormInput,
  | 'appType'
  | 'category'
  | 'description'
  | 'displayName'
  | 'icon'
  | 'slug'
  | 'source'
  | 'status'
  | 'tags'
>;

export type ModuleAppIdentityUpsertInput = ModuleAppAdminUpsertInput & {
  entitlements: ModuleAppPlanEntitlement[];
};

export const createDefaultModuleAppIdentity = (): ModuleAppIdentityFormValues => {
  const values = createDefaultModuleAppFormValues();
  return {
    appType: values.appType,
    category: values.category,
    description: values.description,
    displayName: values.displayName,
    icon: values.icon,
    slug: values.slug,
    source: values.source,
    status: values.status,
    tags: values.tags,
  };
};

export const buildIdentityUpsertInput = (
  identity: ModuleAppIdentityFormValues,
  current?: AdminModuleAppDetail | null,
): ModuleAppIdentityUpsertInput => {
  const base = (current ?? createDefaultModuleAppFormValues()) as ModuleAppAdminFormInput;
  const values = normalizeModuleAppFormValues({
    ...base,
    ...identity,
    actions: current?.actions ?? base.actions,
    billing: current?.billing ?? base.billing,
    entitlements: current?.entitlements ?? base.entitlements,
    id: current?.id ?? base.id,
    pages: current?.pages ?? base.pages,
  });

  return { ...buildModuleAppUpsertInput(values), entitlements: values.entitlements };
};
