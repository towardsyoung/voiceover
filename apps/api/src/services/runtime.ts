let shuttingDown = false;

export function beginShutdown(): void {
  shuttingDown = true;
}

export function resetShutdown(): void {
  shuttingDown = false;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}
