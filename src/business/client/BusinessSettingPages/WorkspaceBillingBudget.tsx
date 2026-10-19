'use client';

import { Navigate } from 'react-router';

/** There is no personal budget page, so use the existing billing controls. */
export default function WorkspaceBillingBudget() {
  return <Navigate replace to="/settings/billing" />;
}
