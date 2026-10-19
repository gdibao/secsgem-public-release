const MODULE_APP_WORKFLOW_ENTITLEMENT_DENIAL_CODES = new Set([
  'MODULE_APP_ENTITLEMENT_HIDDEN',
  'MODULE_APP_ENTITLEMENT_INSTALL_DENIED',
  'MODULE_APP_ENTITLEMENT_LICENSE_EXPIRED',
  'MODULE_APP_ENTITLEMENT_PURCHASE_REQUIRED',
  'MODULE_APP_ENTITLEMENT_SUSPENDED',
  'MODULE_APP_INSTALLATION_REQUIRED',
]);

export const isModuleAppWorkflowEntitlementDeniedError = (error: unknown) => {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return code ? MODULE_APP_WORKFLOW_ENTITLEMENT_DENIAL_CODES.has(code) : false;
};
