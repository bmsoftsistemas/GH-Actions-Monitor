// Stub mínimo do módulo "electron" pra permitir carregar store.js fora de um
// processo Electron real (só o suficiente pro que normalizeRepo precisa).
module.exports = {
  app: {
    getPath: () => require("node:os").tmpdir(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  },
};
