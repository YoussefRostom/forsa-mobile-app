export function isSuspendedEntity(data: Record<string, any> | null | undefined): boolean {
  if (!data) return false;

  return data.isSuspended === true || String(data.status || '').toLowerCase() === 'suspended';
}

