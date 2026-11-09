import fs from 'fs';
import path from 'path';
import { generateTestWav, convertWavFileToMp3 } from '../backend/services/converter.ts';
import { sanitizeFilename, isValidFilename, validateWavBuffer } from '../backend/services/validator.ts';
import { storageService } from '../backend/services/storage.ts';
import { queueManager } from '../backend/services/queue.ts';
import { WAV_DIR, MP3_DIR, FAILED_DIR } from '../backend/config/config.ts';
import JSZip from 'jszip';

console.log('====================================================');
console.log('   AI TTS AUTOMATION STUDIO V1.0 - INTEGRATION TEST');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, desc: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] Test ${totalTests}: ${desc}`);
  } else {
    console.error(`[FAIL] Test ${totalTests}: ${desc}`);
  }
}

async function runTests() {
  // Test 1: Filename sanitizer & validation
  const testName1 = sanitizeFilename('001/pembukaan?test*track:1');
  assert(testName1 === '001-pembukaan-test-track-1', 'Sanitasi nama file membersihkan karakter ilegal dan traversal');

  const validCheck = isValidFilename('001_narasi_studio');
  assert(validCheck.valid === true, 'Nama file valid diterima oleh validator');

  const invalidCheck = isValidFilename('../hack_path');
  assert(invalidCheck.valid === false, 'Karakter path traversal ditolak');

  // Test 2: WAV Buffer Generation & Validation
  const sampleWav = generateTestWav(2.0, 24000, 440);
  assert(sampleWav.length > 44, 'Sintesis berkas PCM WAV menghasilkan buffer valid > 44 bytes');

  const wavCheck = validateWavBuffer(sampleWav);
  assert(wavCheck.valid === true && wavCheck.channels === 1, 'Header RIFF WAVE dan PCM terverifikasi valid');

  // Test 3: WAV to MP3 Conversion
  const testWavPath = path.join(WAV_DIR, 'test_sample.wav');
  const testMp3Path = path.join(MP3_DIR, 'test_sample.mp3');

  fs.writeFileSync(testWavPath, sampleWav);
  assert(fs.existsSync(testWavPath), 'File WAV berhasil ditulis ke storage/wav/');

  const conv = await convertWavFileToMp3(testWavPath, testMp3Path, 192);
  assert(conv.success === true, 'Konversi WAV ke MP3 (192 kbps) berhasil');
  assert(fs.existsSync(testMp3Path), 'File MP3 berhasil ditulis ke storage/mp3/');

  const mp3Stat = fs.statSync(testMp3Path);
  assert(mp3Stat.size > 1024, `Ukuran file MP3 masuk akal (${mp3Stat.size} bytes)`);

  // Test 4: Storage service persistence
  const jobs = storageService.getJobs();
  assert(Array.isArray(jobs), 'Storage service berhasil memuat metadata pekerjaan');

  storageService.addLog('default', {
    level: 'INFO',
    message: 'Integration test log entry verified',
  });
  const logs = storageService.getLogs('default', 5);
  assert(logs.some((l) => l.message.includes('Integration test log')), 'Pencatatan log aktivitas persisten');

  // Test 5: ZIP package generation
  const zip = new JSZip();
  zip.file('test_sample.mp3', fs.readFileSync(testMp3Path));
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  assert(zipBuf.length > 100, `Pembuatan arsip ZIP seluruh MP3 berhasil (${zipBuf.length} bytes)`);

  // Cleanup test files so storage remains clean 0
  try {
    if (fs.existsSync(testWavPath)) fs.unlinkSync(testWavPath);
    if (fs.existsSync(testMp3Path)) fs.unlinkSync(testMp3Path);
    storageService.clearLogs('default');
  } catch {}

  // Test 6: Extension files check
  const extManifest = path.join(process.cwd(), 'extension', 'manifest.json');
  assert(fs.existsSync(extManifest), 'Berkas Manifest V3 ekstensi Chrome tersedia');

  const extSelectors = path.join(process.cwd(), 'extension', 'selectors.js');
  assert(fs.existsSync(extSelectors), 'Modul selektor dinamis Google AI Studio tersedia');

  const extBridge = path.join(process.cwd(), 'extension', 'bridge.js');
  assert(fs.existsSync(extBridge), 'Berkas bridge dua arah ekstensi tersedia');

  const extInterceptor = path.join(process.cwd(), 'extension', 'interceptor.js');
  assert(fs.existsSync(extInterceptor), 'Berkas main world interceptor ekstensi tersedia');

  // Test 7: Extension zip builder packaging check
  const { buildExtensionZip } = await import('../backend/services/extensionPacker.ts');
  const extZipBuf = await buildExtensionZip('https://aittsbroo.vercel.app', 'pc_test');
  assert(extZipBuf.length > 5000, `Pembuatan paket ZIP ekstensi terisi berkas lengkap (${extZipBuf.length} bytes)`);

  // Test 8: Queue One-Job-At-A-Time logic
  assert(queueManager.getQueueState() === 'IDLE' || queueManager.getQueueState() === 'STOPPED', 'Status antrean awal berada dalam kondisi IDLE/STOPPED');

  console.log('\n====================================================');
  console.log(`HASIL PENGUJIAN: ${passedTests} / ${totalTests} BERHASIL`);
  console.log('====================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal error in tests:', e);
  process.exit(1);
});
