import JSZip from 'jszip';
import { getClientId } from './clientWorkspace';

// Icon PNG Base64 Assets
const ICON16_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAiklEQVR4nGNgoDXwW/bjP8maPFf/+O+z8sd/kObAJT/+By/88T9s/o//EXOIMAyf5uhZP/7HTsdjCDGaE6b++J80CYshpGhOnfDjf3ovmiGkas7qRjOAVM05HUgGkKM5v+3H/8JmJEMo0gwCpGouaUQzgFTNZXVYopIizTBAkWYYoEgzOsAIbTQAAJuqsxxuUE44AAAAAElFTkSuQmCC';
const ICON48_B64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABj0lEQVR4nO3YV08CQRiFYf6cYsGu2BW7YsGCBexix67YFbvY/953d8xcbLIZWVzWZXe+xJPM/fPeTCbj8fwv83wpgtsGUyt4JxS+EYpeCcUvBJ84KULJM6H0iVD2SCh/IFSIc0+ovFMgzPtJ8H4QrOCrbgnVN4SaJMGfdDgmX8BtxPuvCbVXhLpLB0Jyia+/IDSc5ygi74vgBL5RnDNC06mNIW7gm08ILcc2RLiJb00QAok/RKiADxwR2g4tRKiEbv8gdOxnGaEavnMviwAV8V3i7JqIUBnfvUPo2f4lQnV871aGAA74vjghGDeI4IIPbhoEcMH3b6QJ4IQfWCcMrkkR3PBDq1IAN3xIDuCGD61IAdzww8tyADP8SEwXwBE/ukQYW9RFsMaLccOH5QBu+PCCFMANPz4vBzDDT8xJAdzwk7NpHnSs8WJc8FMzBgFc8BGjADHWeDHV8ZFpE18rrPHaWOPFVMNHoxY+eFnjtbHGa2ON18Yar59yt42Vscbr59jzwInZ9iRWbT9+D2zeN0VO2Y3BvwYEAAAAAElFTkSuQmCC';
const ICON128_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAD7ElEQVR4nO3dVW8bQRiF4fy4tikzM0PKTSlNmZmZmenn+c7VZPtpnexubMe7np0575G++3ie9yJSpHhggDHlzf3aaPr+GVjJm/Wj0bSb/T29Od/Sm+vua3rzvqQ3/3N6Cz6lt/AjsdRyM382mnZV4tstcvchOd+fXXKDvxpNO5/47ha/T2/JO4KobDN+N5qDv1P4OuLbLX2bnO83i2IOPkR8d8veJOf7DYOcwYeO7265u9eE0NGm/0nhY8K3W/GKEHLn4BXw7Va+JISxGbwavt2qF6IhTPubwivj261+LhQC+Fl8O982lQ/8Yvw17p5FGoGDB789vt3apxGFAH73+Ha+7Xoe+FPHX/ckOd+GUx74veO7W/84sAgMHvxy8O02PAogBPCrw7fzbVw48KvH3+juYQ0jAL9/+Ha+zccN/P7ib3pQowDA7z++nW978D3ib76fHPjC+O623PMQAfj1wbfrewDg1wd/690+BgB+/fDtwBfG3+buToURgF9/fLtKAgA/DPzttysIAPxw8O0qCQD8MPB33CoxAPDDw7crLQDww8PfebOEAMAPF9+upwDADxt/140eAgA/fHy7ngIAP2z8oakEAH48+EPXk+s6APDjwe8qAPDjw999LbmOAgA/TvzOAwA/Svw9VzsIAPx48e06CgD8OPH3XukgAPDjxW8bAPhx408aAPjx4++7nNykAYAfN/6kAYAfP/7+ogDA18DffyknAPB18O1yAwBfA//AxZwAwNfBzwQAvhZ+YQDga+AfvJATAPg6+JkAwNfCLwwAfA38Q+dzAgBfBz8TAPha+NkAwJfCHz7XEgD4evh24yIAXxTfDXwt/MNFAYCvgX/4bE4A4OvgZwIAXwu/MADwNfCPnMkJAHwd/EwA4GvhFwYAvgb+0dM5AYCvg58JAHwt/EwAFgH4ovhu4GvgHztVFAD4EvhtAwA/bvzCANzAF8ZvDQD8OPGPn+wgAPDjxW8bAPhx47cNwCIAXxTfDfw48Ue6DQD8uPBHRrv4h9HgC+O3BgB+HPhdB+AGvjD+WADgR4E/5QAsAvBF8d3ADxv/xIkSvjwSfGF8N/DDxC8tAIsAfFF8N/DDwi89AIsAfFF8N/DDwB8dqSgAiwB8UXwb+ML4rRGAL4rvBn698PsegEUAvii+DXxhfBv4wvg28IXx3cDvL37tAhj4HwH4ovg28IXxbeAL47cO/Eh/4etm4Avj28AXxreBL4zfOvBr9lc9HwNfGN8GvjB+68AXhZ84RXzfb17LKeD7fuMgFiO+7zcNcjHg+37DKBYivu83i3Z1xvf9NpLzie/7s7OcVYnv+7Oxkjc88UuUxfYPZ178xq9EBy4AAAAASUVORK5CYII=';

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
      'selectors.js',
      'bridge.js',
      'popup.html',
      'popup.css',
      'popup.js',
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
          } else if (f === 'popup.html') {
            text = text.replace(/value="[^"]*"/, `value="${cleanUrl}"`);
          }
          zip.file(f, text);
          fetchedAny = true;
        }
      } catch (e) {}
    }

    // Add icon files
    const iconsFolder = zip.folder('icons');
    if (iconsFolder) {
      iconsFolder.file('icon16.png', ICON16_B64, { base64: true });
      iconsFolder.file('icon48.png', ICON48_B64, { base64: true });
      iconsFolder.file('icon128.png', ICON128_B64, { base64: true });
    }

    // Add dedicated 'unduhan' folder in the extension package (Option 2: default folder)
    const unduhanFolder = zip.folder('unduhan');
    if (unduhanFolder) {
      unduhanFolder.file(
        'TEMPAT_FILE_WAV_DISIMPAN.txt',
        `===================================================================\n📁 FOLDER PENYIMPANAN UNDUHAN WAV - AI TTS AUTOMATION STUDIO V1.0\n===================================================================\n\nFolder "unduhan" ini adalah folder bawaan (default) pada paket ekstensi.\nJika Anda tidak memilih folder kustom di website dashboard, seluruh file WAV\nyang diunduh dari Google AI Studio akan otomatis tersimpan ke dalam folder ini.\n\nAuthor: Faiz_Fahmi_ID\n===================================================================\n`
      );
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
