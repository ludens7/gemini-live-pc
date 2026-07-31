const { contextBridge, shell } = require('electron');
const childProcess = require('child_process');

function getApiKey() {
  // 1. Try standard process.env (loaded at startup)
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  
  // 2. Try Windows Registry fallback (reads current registry in real-time)
  if (process.platform === 'win32') {
    // A. Try User Variables (HKCU)
    try {
      const output = childProcess.execSync('reg query HKCU\\Environment /v GEMINI_API_KEY', { 
        encoding: 'utf8', 
        timeout: 1500 
      });
      const match = output.match(/REG_SZ\s+(.*)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (e) {
      console.warn('Failed to read API Key from User Registry (HKCU):', e.message);
    }

    // B. Try System Variables (HKLM)
    try {
      const output = childProcess.execSync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v GEMINI_API_KEY', { 
        encoding: 'utf8', 
        timeout: 1500 
      });
      const match = output.match(/REG_SZ\s+(.*)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (e) {
      console.warn('Failed to read API Key from System Registry (HKLM):', e.message);
    }
  }
  
  return '';
}

contextBridge.exposeInMainWorld('electronAPI', {
  getApiKey: getApiKey,
  openExternal: (url) => shell.openExternal(url)
});
