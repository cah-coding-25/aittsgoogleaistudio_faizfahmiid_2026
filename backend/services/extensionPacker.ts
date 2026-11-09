import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { APP_ROOT, sanitizeClientId } from '../config/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base64 icons
const ICON16_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAiklEQVR4nGNgoDXwW/bjP8maPFf/+O+z8sd/kObAJT/+By/88T9s/o//EXOIMAyf5uhZP/7HTsdjCDGaE6b++J80CYshpGhOnfDjf3ovmiGkas7qRjOAVM05HUgGkKM5v+3H/8JmJEMo0gwCpGouaUQzgFTNZXVYopIizTBAkWYYoEgzOsAIbTQAAJuqsxxuUE44AAAAAElFTkSuQmCC';
const ICON48_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABj0lEQVR4nO3YV08CQRiFYf6cYsGu2BW7YsGCBexix67YFbvY/953d8xcbLIZWVzWZXe+xJPM/fPeTCbj8fwv83wpgtsGUyt4JxS+EYpeCcUvBJ84KULJM6H0iVD2SCh/IFSIc0+ovFMgzPtJ8H4QrOCrbgnVN4SaJMGfdDgmX8BtxPuvCbVXhLpLB0Jyia+/IDSc5ygi74vgBL5RnDNC06mNIW7gm08ILcc2RLiJb00QAok/RKiADxwR2g4tRKiEbv8gdOxnGaEavnMviwAV8V3i7JqIUBnfvUPo2f4lQnV871aGAA74vjghGDeI4IIPbhoEcMH3b6QJ4IQfWCcMrkkR3PBDq1IAN3xIDuCGD61IAdzww8tyADP8SEwXwBE/ukQYW9RFsMaLccOH5QBu+PCCFMANPz4vBzDDT8xJAdzwk7NpHnSs8WJc8FMzBgFc8BGjADHWeDHV8ZFpE18rrPHaWOPFVMNHoxY+eFnjtbHGa2ON18Yar59yt42Vscbr59jzwInZ9iRWbT9+D2zeN0VO2Y3BvwYEAAAAAElFTkSuQmCC';
const ICON128_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAD7ElEQVR4nO3dVW8bQRiF4fy4tikzM0PKTSlNmZmZmenn+c7VZPtpnexubMe7np0575G++3ie9yJSpHhggDHlzf3aaPr+GVjJm/Wj0bSb/T29Od/Sm+vua3rzvqQ3/3N6Cz6lt/AjsdRyM382mnZV4tstcvchOd+fXXKDvxpNO5/47ha/T2/JO4KobDN+N5qDv1P4OuLbLX2bnO83i2IOPkR8d8veJOf7DYOcwYeO7265u9eE0NGm/0nhY8K3W/GKEHLn4BXw7Va+JISxGbwavt2qF6IhTPubwivj261+LhQC+Fl8O982lQ/8Yvw17p5FGoGDB789vt3apxGFAH73+Ha+7Xoe+FPHX/ckOd+GUx74veO7W/84sAgMHvxy8O02PAogBPCrw7fzbVw48KvH3+juYQ0jAL9/+Ha+zccN/P7ib3pQowDA7z++nW978D3ib76fHPjC+O623PMQAfj1wbfrewDg1wd/690+BgB+/fDtwBfG3+buToURgF9/fLtKAgA/DPzttysIAPxw8O0qCQD8MPB33CoxAPDDw7crLQDww8PfebOEAMAPF9+upwDADxt/140eAgA/fHy7ngIAP2z8oakEAH48+EPXk+s6APDjwe8qAPDjw999LbmOAgA/TvzOAwA/Svw9VzsIAPx48e06CgD8OPH3XukgAPDjxW8bAPhx408aAPjx4++7nNykAYAfN/6kAYAfP/7+ogDA18DffyknAPB18O1yAwBfA//AxZwAwNfBzwQAvhZ+YQDga+AfvJATAPg6+JkAwNfCLwwAfA38Q+dzAgBfBz8TAPha+NkAwJfCHz7XEgD4evh24yIAXxTfDXwt/MNFAYCvgX/4bE4A4OvgZwIAXwu/MADwNfCPnMkJAHwd/EwA4GvhFwYAvgb+0dM5AYCvg58JAHwt/EwAFgH4ovhu4GvgHztVFAD4EvhtAwA/bvzCANzAF8ZvDQD8OPGPn+wgAPDjxW8bAPhx47cNwCIAXxTfDfw48Ue6DQD8uPBHRrv4h9HgC+O3BgB+HPhdB+AGvjD+WADgR4E/5QAsAvBF8d3ADxv/xIkSvjwSfGF8N/DDxC8tAIsAfFF8N/DDwi89AIsAfFF8N/DDwB8dqSgAiwB8UXwb+ML4rRGAL4rvBn698PsegEUAvii+DXxhfBv4wvg28IXx3cDvL37tAhj4HwH4ovg28IXxbeAL47cO/Eh/4etm4Avj28AXxreBL4zfOvBr9lc9HwNfGN8GvjB+68AXhZ84RXzfb17LKeD7fuMgFiO+7zcNcjHg+37DKBYivu83i3Z1xvf9NpLzie/7s7OcVYnv+7Oxkjc88UuUxfYPZ178xq9EBy4AAAAASUVORK5CYII=';

// Helper to find extension folder on disk
export function findExtensionDir(): string | null {
  const candidates = [
    path.join(APP_ROOT, 'extension'),
    path.join(process.cwd(), 'extension'),
    path.resolve('extension'),
    path.resolve(__dirname, '..', '..', 'extension'),
    path.resolve(__dirname, '..', 'extension'),
    '/app/applet/extension',
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.existsSync(path.join(c, 'manifest.json'))) {
        return c;
      }
    } catch {}
  }
  return null;
}

/**
 * Generate a complete, ready-to-load Chrome Extension ZIP with pre-configured backend URL and workspace clientId.
 */
export async function buildExtensionZip(targetBackendUrl: string, rawClientId?: string): Promise<Buffer> {
  const cleanBackendUrl = (targetBackendUrl || 'http://localhost:3000').replace(/\/$/, '');
  const cleanClientId = sanitizeClientId(rawClientId);
  const zip = new JSZip();

  const diskDir = findExtensionDir();

  if (diskDir) {
    function addDirToZip(dirPath: string, zipFolder: JSZip) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullP = path.join(dirPath, file);
        const stat = fs.statSync(fullP);
        if (stat.isDirectory()) {
          const sub = zipFolder.folder(file);
          if (sub) addDirToZip(fullP, sub);
        } else {
          let content = fs.readFileSync(fullP);
          if (file === 'background.js') {
            let bgText = content.toString('utf-8');
            bgText = bgText.replace(
              /let backendUrl = '[^']*';/,
              `let backendUrl = '${cleanBackendUrl}';`
            );
            if (bgText.includes('let clientId =')) {
              bgText = bgText.replace(/let clientId = '[^']*';/, `let clientId = '${cleanClientId}';`);
            } else {
              bgText = `let clientId = '${cleanClientId}';\n` + bgText;
            }
            zipFolder.file(file, bgText);
          } else if (file === 'content.js') {
            let ctText = content.toString('utf-8');
            ctText = ctText.replace(
              /let backendUrl = '[^']*';/,
              `let backendUrl = '${cleanBackendUrl}';`
            );
            if (ctText.includes('let clientId =')) {
              ctText = ctText.replace(/let clientId = '[^']*';/, `let clientId = '${cleanClientId}';`);
            } else {
              ctText = `let clientId = '${cleanClientId}';\n` + ctText;
            }
            zipFolder.file(file, ctText);
          } else if (file === 'popup.html') {
            let htmlText = content.toString('utf-8');
            htmlText = htmlText.replace(
              /<span id="backend-url" class="val">[^<]*<\/span>/,
              `<span id="backend-url" class="val">${cleanBackendUrl}</span>`
            );
            zipFolder.file(file, htmlText);
          } else {
            zipFolder.file(file, content);
          }
        }
      }
    }

    addDirToZip(diskDir, zip);
  } else {
    // In-memory fallback
    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          manifest_version: 3,
          name: 'AI TTS Automation Studio Controller',
          version: '1.1.0',
          description: 'Pengendali otomatis Text-to-Speech Google AI Studio untuk AI TTS Automation Studio V1.0.',
          permissions: ['tabs', 'activeTab', 'scripting', 'storage', 'downloads'],
          host_permissions: ['<all_urls>'],
          background: { service_worker: 'background.js', type: 'module' },
          content_scripts: [
            { matches: ['https://aistudio.google.com/*'], js: ['interceptor.js'], world: 'MAIN', run_at: 'document_start' },
            { matches: ['https://aistudio.google.com/*'], js: ['selectors.js', 'content.js'], run_at: 'document_idle' },
            { matches: ['<all_urls>'], js: ['bridge.js'], run_at: 'document_start' },
          ],
          action: {
            default_popup: 'popup.html',
            default_title: 'AI TTS Automation Studio',
            default_icon: { '16': 'icons/icon16.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' },
          },
          icons: { '16': 'icons/icon16.png', '48': 'icons/icon48.png', '128': 'icons/icon128.png' },
        },
        null,
        2
      )
    );

    const iconsFolder = zip.folder('icons');
    if (iconsFolder) {
      iconsFolder.file('icon16.png', Buffer.from(ICON16_BASE64, 'base64'));
      iconsFolder.file('icon48.png', Buffer.from(ICON48_BASE64, 'base64'));
      iconsFolder.file('icon128.png', Buffer.from(ICON128_BASE64, 'base64'));
    }

    const unduhanFolder = zip.folder('unduhan');
    if (unduhanFolder) {
      unduhanFolder.file(
        'TEMPAT_FILE_WAV_DISIMPAN.txt',
        `===================================================================\n📁 FOLDER PENYIMPANAN UNDUHAN WAV - AI TTS AUTOMATION STUDIO V1.0\n===================================================================\n\nFolder "unduhan" ini adalah folder bawaan (default) pada paket ekstensi.\nJika Anda tidak memilih folder kustom di website dashboard, seluruh file WAV\nyang diunduh dari Google AI Studio akan otomatis tersimpan ke dalam folder ini.\n\nAuthor: Faiz_Fahmi_ID\n===================================================================\n`
      );
    }
  }

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
