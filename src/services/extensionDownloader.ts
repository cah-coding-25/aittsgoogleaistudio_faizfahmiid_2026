import JSZip from 'jszip';
import { getClientId } from './clientWorkspace';

// Icon PNG Base64 Assets
const ICON16_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABpFBMVEUAACgAACkAASoAASsAASwAAS4AAS8BATECAjMBAjIAAjIAAzAAAy4AAioAACoAAS0AATAAATMBATkAADkAADgAADQAADAAACsAACUBATUCAjwAADsPBFUfC3ISEnEIG2wBI2MAK14AMVkAAiwAATIBADMAADMqB3eVGfh+N/9GZ/4dlP4GwPwA/P8AqbwAACYCASsAACQ1EG02FHpTCclbENAjFYgTIoUILIMBN3wARnUAED4AASkBASsFADM6CH1pI7pSI64eAIQnDp0pM9EYX9QIiM8GuNQWlagBAC4AAi4BACozB5dEFLQ+KsEhIpEnAKU/HP8ePeUOaOQEnOYL2/IPWHsAAC0FAT8RFIIWO7cWNKo0AKoaFYAJLnsBS4QAVX4ABjsAADUAATcAACcBHmMII3ZMB5pATPgQkv4Bzf8AfqYAAEAABUQCATUcAEWEIPwvT+cBImMBEE8AAT8AAUUAATkDATEAASVQBYGHKP8LGWsBAEkAAkYAATwAATQBAS0eA04aBlYAADcBAkgAAkAAAToAATUAATYAATEBAS4BATDVnLG7AAAA8UlEQVQY02NgYGBkZGRiYgYCJkYGRgYQYGJhZWPn4OTi5uEF8/n4BQSFhEVERMXEJUB8Rn42SSlpGVk5eQVFJWWQAlYVVTV1DU0tbR1dPX2gJj4DQyNjE1MzcwtLK2s+GwYGWzt7B0cnZxdXN3cPTy8GBm9DH18//4DAoOCQ0LBwHpClEZFR0TGxcfEJiUnJzCBDmVNS09IzMrOyc3JVmEDWsubx5RcUFhWXlJYJ8IEcwlxeUVlVLVpTW1fPD3Y6XwNDY1NzS2tbuwAzI0iEkYmfMbyto12wkx/CZ2Tk6+oW6BRgY2GECICFgL7nYwQJAAA6MCn/Ur134wAAAABJRU5ErkJggg==';
const ICON48_B64 = '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';
const ICON128_B64 = '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';

/**
 * Downloads the Chrome Extension ZIP.
 * Configures the backend URL and the current client workspace ID.
 */
export async function downloadExtensionZipClient(backendUrl?: string): Promise<boolean> {
  const clientId = getClientId();
  const currentUrl = backendUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const cleanUrl = currentUrl.replace(/\/$/, '');

  try {
    // 1. Try server endpoint first
    try {
      const serverRes = await fetch(
        `/api/extension/download-zip?backendUrl=${encodeURIComponent(cleanUrl)}&clientId=${encodeURIComponent(clientId)}`
      );
      if (serverRes.ok) {
        const blob = await serverRes.blob();
        if (blob.size > 1000) {
          triggerBlobDownload(blob, `AI_TTS_Chrome_Extension_${clientId}.zip`);
          return true;
        }
      }
    } catch (e) {
      console.warn('Server download endpoint request failed, proceeding to client builder...', e);
    }

    // 2. Fetch extension files from static extension directory or inline templates
    const zip = new JSZip();

    const fileList = [
      'manifest.json',
      'background.js',
      'content.js',
      'interceptor.js',
      'selectors.js',
      'bridge.js',
      'sidepanel.html',
      'sidepanel.css',
      'sidepanel.js',
      'popup.html',
      'popup.css',
      'popup.js',
      'folder-picker.html',
      'folder-picker.js',
      'unduhan/README.txt',
    ];

    let fetchedAny = false;
    for (const f of fileList) {
      try {
        const r = await fetch(`/extension-static/${f}`);
        if (r.ok) {
          let text = await r.text();
          if (f === 'background.js') {
            text = text.replace(/let backendUrl = '[^']*';/, `let backendUrl = '${cleanUrl}';`);
            if (text.includes('let clientId =')) {
              text = text.replace(/let clientId = '[^']*';/, `let clientId = '${clientId}';`);
            } else {
              text = `let clientId = '${clientId}';\n` + text;
            }
          } else if (f === 'content.js') {
            text = text.replace(/let backendUrl = '[^']*';/, `let backendUrl = '${cleanUrl}';`);
            if (text.includes('let clientId =')) {
              text = text.replace(/let clientId = '[^']*';/, `let clientId = '${clientId}';`);
            } else {
              text = `let clientId = '${clientId}';\n` + text;
            }
          } else if (f === 'sidepanel.js') {
            text = text.replace(
              /const DEFAULT_BACKEND_URL = '[^']*';/,
              `const DEFAULT_BACKEND_URL = '${cleanUrl}';`
            );
            text = text.replace(
              /let currentBackendUrl = '[^']*';/,
              `let currentBackendUrl = '${cleanUrl}';`
            );
            text = text.replace(
              /let clientId = '[^']*';/,
              `let clientId = '${clientId}';`
            );
          } else if (f === 'popup.js') {
            text = text.replace(
              /const DEFAULT_BACKEND_URL = '[^']*';/,
              `const DEFAULT_BACKEND_URL = '${cleanUrl}';`
            );
            text = text.replace(
              /let currentBackendUrl = '[^']*';/,
              `let currentBackendUrl = '${cleanUrl}';`
            );
          } else if (f === 'popup.html') {
            text = text.replace(
              /<span id="backend-url" class="val">[^<]*<\/span>/,
              `<span id="backend-url" class="val">${cleanUrl}</span>`
            );
          }
          zip.file(f, text);
          fetchedAny = true;
        }
      } catch (e) {}
    }

    // Add icon files (prefer static binary PNGs, fallback to embedded base64)
    const iconsFolder = zip.folder('icons');
    if (iconsFolder) {
      const iconPairs: Array<[string, string]> = [
        ['icon16.png', ICON16_B64],
        ['icon48.png', ICON48_B64],
        ['icon128.png', ICON128_B64],
      ];
      for (const [iconName, fallbackB64] of iconPairs) {
        let added = false;
        try {
          const r = await fetch(`/extension-static/icons/${iconName}`);
          if (r.ok) {
            iconsFolder.file(iconName, await r.arrayBuffer());
            added = true;
          }
        } catch {}
        if (!added) {
          iconsFolder.file(iconName, fallbackB64, { base64: true });
        }
      }
    }

    if (fetchedAny) {
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      triggerBlobDownload(zipBlob, `AI_TTS_Chrome_Extension_${clientId}.zip`);
      return true;
    }

    // Ultimate fallback: trigger direct window download
    const link = document.createElement('a');
    link.href = `/api/extension/download-zip?backendUrl=${encodeURIComponent(cleanUrl)}&clientId=${encodeURIComponent(clientId)}`;
    link.download = `AI_TTS_Chrome_Extension_${clientId}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    console.error('Failed to generate extension zip:', err);
    return false;
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
