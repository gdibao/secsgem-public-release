'use client';

import { Navigate } from 'react-router';

/** Workspace commercial data is not workspace-scoped yet; keep this route usable. */
export default function WorkspaceBillingCredits() {
  return <Navigate replace to="/settings/credits" />;
}
