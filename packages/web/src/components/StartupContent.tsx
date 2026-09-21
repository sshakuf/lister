import type { ReactNode } from 'react';
import { ApiError } from '../hive/http';

export function startupErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError && error.status === 401) return null;
  return `Cannot reach the Lister server: ${error instanceof Error ? error.message : String(error)}`;
}

export function StartupContent({ ready, authRequired, error, onRetry, children }: {
  ready: boolean; authRequired: boolean; error: string | null; onRetry: () => void; children: ReactNode;
}) {
  if (ready) return <>{children}</>;
  if (authRequired) return null;
  return <div className="outline loading">{error ? <>
    <p>{error}</p><button onClick={onRetry}>Retry connection</button> <a href="#/admin">Set up a hive</a>
  </> : 'Connecting…'}</div>;
}
