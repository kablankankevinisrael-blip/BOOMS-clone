// Système debug minimal et sécurisé
const debug = {
  log: (...args: any[]) => console.log('[BOOMS]', ...args),
  error: (...args: any[]) => console.error('[BOOMS ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[BOOMS WARN]', ...args),
  info: (...args: any[]) => console.info('[BOOMS INFO]', ...args),
  enable: () => {},
  disable: () => {},
  getLogs: () => [],
  clearLogs: () => {},
  exportLogs: () => '',
  testNetworkConnection: async () => {},
  testImports: () => {},
};

export { debug };