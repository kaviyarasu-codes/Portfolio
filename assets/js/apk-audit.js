// In-browser Android APK checker for site-audit.html.
// The APK never leaves the browser: it is read with Blob.slice, unzipped with
// DecompressionStream and the binary AndroidManifest.xml is decoded here.
// Only the resulting findings are sent to the server for the AI review.

/* ── ZIP reader ─────────────────────────────────────────── */

async function bytesOf(blob) { return new Uint8Array(await blob.arrayBuffer()); }

export async function readZip(blob) {
  const tailSize = Math.min(blob.size, 66000);
  const tail = await bytesOf(blob.slice(blob.size - tailSize));
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This file is not a valid APK/ZIP archive.');
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // ZIP64: the locator sits just before the EOCD record.
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) throw new Error('Unsupported ZIP64 archive.');
    const z64 = await bytesOf(blob.slice(Number(tv.getBigUint64(loc + 8, true)), Number(tv.getBigUint64(loc + 8, true)) + 56));
    const zv = new DataView(z64.buffer);
    count = Number(zv.getBigUint64(32, true));
    cdSize = Number(zv.getBigUint64(40, true));
    cdOffset = Number(zv.getBigUint64(48, true));
  }
  const cd = await bytesOf(blob.slice(cdOffset, cdOffset + cdSize));
  const v = new DataView(cd.buffer);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      name,
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { blob, entries, cdOffset };
}

/** Extracts an entry; with maxBytes, stops early (enough for file headers). */
export async function extract(zip, entry, maxBytes = Infinity) {
  const head = await bytesOf(zip.blob.slice(entry.offset, entry.offset + 30));
  const hv = new DataView(head.buffer);
  if (hv.getUint32(0, true) !== 0x04034b50) throw new Error(`Corrupt entry ${entry.name}`);
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const raw = zip.blob.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return bytesOf(maxBytes < Infinity ? raw.slice(0, maxBytes) : raw);
  if (entry.method !== 8) throw new Error(`Unsupported compression in ${entry.name}`);
  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) { await reader.cancel(); break; }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/* ── Binary XML (AXML) decoder ──────────────────────────── */

// Android attribute resource IDs, used when attribute names are stripped by obfuscators.
const ATTR_IDS = {
  0x01010003: 'name', 0x01010006: 'permission', 0x01010010: 'exported', 0x0101000f: 'debuggable',
  0x0101020c: 'minSdkVersion', 0x01010270: 'targetSdkVersion', 0x0101021b: 'versionCode', 0x0101021c: 'versionName',
  0x01010280: 'allowBackup', 0x010104ec: 'usesCleartextTraffic', 0x01010527: 'networkSecurityConfig',
  0x01010272: 'testOnly', 0x01010026: 'scheme', 0x01010028: 'host', 0x010104ee: 'autoVerify',
  0x01010473: 'fullBackupContent', 0x0101064c: 'dataExtractionRules', 0x01010572: 'compileSdkVersion',
  0x0101018d: 'grantUriPermissions', 0x01010007: 'readPermission', 0x01010008: 'writePermission',
};

function readStringPool(v, u8, off) {
  const count = v.getUint32(off + 8, true);
  const flags = v.getUint32(off + 16, true);
  const stringsStart = v.getUint32(off + 20, true);
  const utf8 = (flags & 0x100) !== 0;
  const strings = new Array(count);
  const dec8 = new TextDecoder('utf-8');
  const dec16 = new TextDecoder('utf-16le');
  for (let i = 0; i < count; i++) {
    let p = off + stringsStart + v.getUint32(off + v.getUint16(off + 2, true) + i * 4, true);
    if (utf8) {
      p += (u8[p] & 0x80) ? 2 : 1; // char length
      let len = u8[p];
      if (len & 0x80) { len = ((len & 0x7f) << 8) | u8[p + 1]; p += 2; } else p += 1;
      strings[i] = dec8.decode(u8.subarray(p, p + len));
    } else {
      let len = v.getUint16(p, true);
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | v.getUint16(p + 2, true); p += 4; } else p += 2;
      strings[i] = dec16.decode(u8.subarray(p, p + len * 2));
    }
  }
  return strings;
}

function typedValue(type, data, raw, strings) {
  switch (type) {
    case 0x03: return strings[raw] ?? strings[data];
    case 0x12: return data !== 0;
    case 0x10: return data | 0;
    case 0x11: return `0x${(data >>> 0).toString(16)}`;
    case 0x01: return `@0x${(data >>> 0).toString(16)}`;
    default: return raw !== 0xffffffff ? strings[raw] : data;
  }
}

export function parseAxml(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint16(0, true) !== 0x0003) throw new Error('Not a binary Android XML file (is this an .aab? Upload an .apk instead).');
  let strings = [];
  let resIds = [];
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let p = v.getUint16(2, true);
  while (p + 8 <= u8.length) {
    const type = v.getUint16(p, true);
    const size = v.getUint32(p + 4, true);
    if (size < 8) break;
    if (type === 0x0001) strings = readStringPool(v, u8, p);
    else if (type === 0x0180) { resIds = []; for (let i = p + 8; i < p + size; i += 4) resIds.push(v.getUint32(i, true)); }
    else if (type === 0x0102) {
      const name = strings[v.getUint32(p + 20, true)];
      const attrStart = v.getUint16(p + 24, true), attrSize = v.getUint16(p + 26, true), attrCount = v.getUint16(p + 28, true);
      const el = { tag: name, attrs: {}, children: [] };
      for (let i = 0; i < attrCount; i++) {
        const a = p + 16 + attrStart + i * attrSize;
        const nameIdx = v.getUint32(a + 4, true);
        const key = strings[nameIdx] || ATTR_IDS[resIds[nameIdx]] || `attr${nameIdx}`;
        el.attrs[key] = typedValue(u8[a + 15], v.getUint32(a + 16, true), v.getUint32(a + 8, true), strings);
      }
      stack[stack.length - 1].children.push(el);
      stack.push(el);
    } else if (type === 0x0103) {
      if (stack.length > 1) stack.pop();
    }
    p += size;
  }
  return root.children[0] || root;
}

const all = (el, tag) => el.children.flatMap((c) => (c.tag === tag ? [c] : []).concat(all(c, tag)));
const kids = (el, tag) => el.children.filter((c) => c.tag === tag);

/* ── Checks ──────────────────────────────────────────────── */

const f = (severity, id, title, detail, fix) => ({ severity, id, title, detail, fix });

const DANGEROUS = ['CAMERA', 'RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS', 'READ_CALENDAR', 'WRITE_CALENDAR', 'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'BODY_SENSORS', 'ACTIVITY_RECOGNITION', 'POST_NOTIFICATIONS', 'NEARBY_WIFI_DEVICES', 'BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT'];
// Need a Google Play declaration form or are heavily restricted.
const RESTRICTED = ['READ_SMS', 'SEND_SMS', 'RECEIVE_SMS', 'RECEIVE_MMS', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS', 'MANAGE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES', 'REQUEST_INSTALL_PACKAGES', 'ACCESS_BACKGROUND_LOCATION', 'SYSTEM_ALERT_WINDOW', 'BIND_ACCESSIBILITY_SERVICE', 'USE_FULL_SCREEN_INTENT', 'SCHEDULE_EXACT_ALARM', 'FOREGROUND_SERVICE_SPECIAL_USE', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'];

const SECRET_PATTERNS = [
  // Header followed by real base64 key data (a bare header is just a PEM-parser constant).
  ['critical', 'Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{64,}/g],
  ['critical', 'Stripe live secret key', /\bsk_live_[0-9a-zA-Z]{20,}/g],
  ['high', 'AWS access key ID', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['high', 'GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['high', 'Slack token', /\bxox[baprs]-[0-9A-Za-z-]{10,}/g],
  ['high', 'OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['high', 'Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['high', 'SendGrid API key', /\bSG\.[\w-]{22}\.[\w-]{43}\b/g],
  ['high', 'Twilio auth/API key', /\bSK[0-9a-f]{32}\b/g],
  ['medium', 'Hardcoded JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['medium', 'Password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s/@"']{3,}@[^\s"']+/gi],
  ['info', 'Google/Firebase API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
];
const CODE_PATTERNS = [
  ['high', 'TLS hostname checks disabled', /ALLOW_ALL_HOSTNAME_VERIFIER|AllowAllHostnameVerifier|NoopHostnameVerifier/, 'Use the default HostnameVerifier; never accept all hostnames.'],
  ['medium', 'WebView can read local files from any origin', /setAllowUniversalAccessFromFileURLs|setAllowFileAccessFromFileURLs/, 'Remove these calls or set them to false.'],
  ['low', 'WebView JavaScript bridge in use', /addJavascriptInterface/, 'Expose only @JavascriptInterface methods you need, and only load trusted URLs in that WebView.'],
  ['info', 'WebView remote debugging switch present', /setWebContentsDebuggingEnabled/, 'Make sure it is only enabled in debug builds.'],
];
const IGNORE_HTTP = /^(schemas\.android\.com|www\.w3\.org|ns\.adobe\.com|xmlpull\.org|www\.apache\.org|apache\.org|xml\.org|java\.sun\.com|localhost|127\.0\.0\.1|10\.0\.2\.2|purl\.org|json-schema\.org|www\.google\.com|play\.google\.com|xmlns\.jcp\.org|example\.com|www\.example\.com)$/i;

function redact(s) { return s.length <= 12 ? `${s.slice(0, 4)}…` : `${s.slice(0, 8)}…${s.slice(-3)}`; }

function latin1(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}

function elfLoadAlignment(u8) {
  if (u8.length < 64 || u8[0] !== 0x7f || u8[1] !== 0x45 || u8[4] !== 2) return null; // ELF64 only
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const phoff = Number(v.getBigUint64(32, true));
  const phentsize = v.getUint16(54, true), phnum = v.getUint16(56, true);
  let min = Infinity;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (o + 56 > u8.length) return null;
    if (v.getUint32(o, true) === 1) min = Math.min(min, Number(v.getBigUint64(o + 48, true)));
  }
  return min === Infinity ? null : min;
}

export async function auditApk(file, onProgress = () => {}) {
  if (/\.aab$/i.test(file.name)) throw new Error('This is an Android App Bundle (.aab). Build a universal APK first: bundletool build-apks --mode=universal, or download the APK from Play Console → App bundle explorer.');
  let zip = await readZip(file);
  let fileName = file.name;

  // .apks / .xapk bundles: analyse the base APK inside.
  if (!zip.entries.has('AndroidManifest.xml')) {
    const apks = [...zip.entries.values()].filter((e) => /\.apk$/i.test(e.name));
    if (!apks.length) throw new Error('No AndroidManifest.xml found. Is this an Android APK?');
    const base = apks.find((e) => /(^|\/)base(-master)?\.apk$/i.test(e.name)) || apks.sort((a, b) => b.size - a.size)[0];
    onProgress(`Opening ${base.name} inside the bundle…`);
    const inner = new Blob([await extract(zip, base)]);
    zip = await readZip(inner);
    fileName = `${file.name} → ${base.name}`;
  }

  onProgress('Reading AndroidManifest.xml…');
  const manifest = parseAxml(await extract(zip, zip.entries.get('AndroidManifest.xml')));
  const app = kids(manifest, 'application')[0] || { attrs: {}, children: [] };
  const sdk = kids(manifest, 'uses-sdk')[0]?.attrs || {};
  const a = (el, n) => el.attrs[`android:${n}`] ?? el.attrs[n];
  const minSdk = Number(a({ attrs: sdk }, 'minSdkVersion') ?? 1);
  const targetSdk = Number(a({ attrs: sdk }, 'targetSdkVersion') ?? minSdk);
  const pkg = manifest.attrs.package;
  const findings = [];

  // Build flags
  if (a(app, 'debuggable') === true) findings.push(f('critical', 'APK-DEBUGGABLE', 'App is built as debuggable', 'android:debuggable="true" lets anyone with USB access attach a debugger and read app data.', 'Ship the release build (debuggable is false by default in release); never set it manually.'));
  if (a(app, 'testOnly') === true) findings.push(f('high', 'APK-TEST-ONLY', 'App is marked testOnly', 'Google Play rejects testOnly APKs; it is usually a debug build from Android Studio.', 'Build with ./gradlew assembleRelease / bundleRelease.'));
  if (a(app, 'allowBackup') !== false && !a(app, 'dataExtractionRules') && !a(app, 'fullBackupContent')) findings.push(f('medium', 'APK-BACKUP', 'App data can be backed up without rules', 'allowBackup is on (default) with no backup rules, so tokens and private files can be copied via backup/device transfer.', 'Set android:allowBackup="false", or add dataExtractionRules / fullBackupContent that exclude tokens and databases.'));
  const cleartext = a(app, 'usesCleartextTraffic');
  if (cleartext === true) findings.push(f('high', 'APK-CLEARTEXT', 'App allows unencrypted HTTP traffic', 'android:usesCleartextTraffic="true" lets data travel without encryption.', 'Remove it and use HTTPS everywhere; allow specific domains only via a network security config if unavoidable.'));
  else if (cleartext === undefined && targetSdk < 28 && !a(app, 'networkSecurityConfig')) findings.push(f('medium', 'APK-CLEARTEXT-DEFAULT', 'HTTP traffic allowed by default (targetSdk < 28)', 'Older target SDKs allow cleartext unless disabled.', 'Raise targetSdk, or add a network security config with cleartextTrafficPermitted="false".'));

  // Network security config (only when the file keeps its readable name)
  const nscEntry = [...zip.entries.values()].find((e) => /^res\/xml\/network_security_config\.xml$/i.test(e.name));
  if (nscEntry) {
    try {
      const nsc = parseAxml(await extract(zip, nscEntry));
      const base = kids(nsc, 'base-config')[0];
      if (base && a(base, 'cleartextTrafficPermitted') === true) findings.push(f('high', 'APK-NSC-CLEARTEXT', 'Network config allows HTTP for all domains', 'base-config cleartextTrafficPermitted="true".', 'Set it to false and allow HTTP only for specific domains if you must.'));
      const userCa = all(nsc, 'certificates').some((c) => c.attrs.src === 'user' && !all(nsc, 'debug-overrides').some((d) => all(d, 'certificates').includes(c)));
      if (userCa) findings.push(f('medium', 'APK-NSC-USER-CA', 'App trusts user-installed certificates', 'Anyone who installs a certificate on the phone can read the app\'s HTTPS traffic.', 'Trust user certificates only inside <debug-overrides>.'));
    } catch { /* unreadable config */ }
  }

  // Target / min SDK (Google Play raises the target requirement every August)
  if (targetSdk < 34) findings.push(f('high', 'APK-TARGET-SDK', `targetSdkVersion is ${targetSdk}`, 'Google Play requires recent target SDKs for new apps and updates (API 35 from Aug 2025, and it rises each year), and older targets miss modern privacy/security behaviour.', 'Raise targetSdkVersion to the current Play requirement and test on the latest Android.'));
  else if (targetSdk < 36) findings.push(f('medium', 'APK-TARGET-SDK', `targetSdkVersion is ${targetSdk}`, 'Google Play\'s yearly target-API deadline (each August) may already require a newer target for updates. Check the current requirement in Play Console.', 'Plan the upgrade to the latest targetSdkVersion.'));
  if (minSdk < 23) findings.push(f('info', 'APK-MIN-SDK', `minSdkVersion is ${minSdk}`, 'Supports very old Android versions without runtime permissions and modern TLS defaults.', 'Consider minSdk 24+ unless you need these devices.'));

  // Components
  const launcher = (el) => all(el, 'intent-filter').some((i) => all(i, 'action').some((x) => a(x, 'name') === 'android.intent.action.MAIN') && all(i, 'category').some((x) => a(x, 'name') === 'android.intent.category.LAUNCHER'));
  const exportedUnprotected = { activity: [], service: [], receiver: [], provider: [] };
  const deepLinks = [];
  for (const type of ['activity', 'activity-alias', 'service', 'receiver', 'provider']) {
    for (const el of all(app, type)) {
      const hasFilter = kids(el, 'intent-filter').length > 0;
      const exp = a(el, 'exported');
      const exported = exp === true || (exp === undefined && hasFilter && targetSdk < 31) || (type === 'provider' && exp === undefined && targetSdk < 17);
      const protectedBy = a(el, 'permission') || (type === 'provider' && (a(el, 'readPermission') || a(el, 'writePermission')));
      if (exp === undefined && hasFilter && targetSdk >= 31) findings.push(f('high', 'APK-EXPORTED-MISSING', `${a(el, 'name')} has an intent-filter but no android:exported`, 'Apps targeting Android 12+ fail to install with this.', 'Set android:exported explicitly.'));
      const name = String(a(el, 'name') || '?');
      if (exported && !protectedBy && !launcher(el) && !name.startsWith('com.google.') && !name.startsWith('androidx.') && !/firebase|FirebaseMessagingService/i.test(name)) {
        exportedUnprotected[type === 'activity-alias' ? 'activity' : type].push(name);
      }
      for (const filter of kids(el, 'intent-filter')) {
        const browsable = all(filter, 'category').some((x) => a(x, 'name') === 'android.intent.category.BROWSABLE');
        if (!browsable) continue;
        for (const d of all(filter, 'data')) {
          const scheme = a(d, 'scheme'), host = a(d, 'host');
          if (scheme) deepLinks.push({ link: `${scheme}://${host || ''}`, verified: a(filter, 'autoVerify') === true });
        }
      }
    }
  }
  if (exportedUnprotected.provider.length) findings.push(f('high', 'APK-EXPORTED-PROVIDER', `${exportedUnprotected.provider.length} content provider(s) open to other apps`, exportedUnprotected.provider.join(', '), 'Set android:exported="false" or protect them with a signature-level permission.'));
  const svcRecv = [...exportedUnprotected.service, ...exportedUnprotected.receiver];
  if (svcRecv.length) findings.push(f('medium', 'APK-EXPORTED-COMPONENTS', `${svcRecv.length} service(s)/receiver(s) any app can call`, svcRecv.join(', '), 'Set android:exported="false" unless other apps must call them; otherwise add android:permission and validate inputs.'));
  if (exportedUnprotected.activity.length) findings.push(f('low', 'APK-EXPORTED-ACTIVITIES', `${exportedUnprotected.activity.length} activity/activities other apps can open`, exportedUnprotected.activity.join(', '), 'Make sure each one validates incoming intent data and does not expose private screens.'));
  const unverified = deepLinks.filter((d) => /^https?:/.test(d.link) && !d.verified);
  if (unverified.length) findings.push(f('low', 'APK-APPLINK-UNVERIFIED', 'Web links are not verified App Links', unverified.map((d) => d.link).join(', '), 'Add android:autoVerify="true" and host /.well-known/assetlinks.json so other apps cannot claim your links.'));

  // Permissions
  const perms = all(manifest, 'uses-permission').concat(all(manifest, 'uses-permission-sdk-23')).map((p) => String(a(p, 'name') || ''));
  const short = perms.map((p) => p.replace(/^android\.permission\./, ''));
  const restricted = short.filter((p) => RESTRICTED.includes(p));
  const dangerous = short.filter((p) => DANGEROUS.includes(p));
  if (restricted.length) findings.push(f('medium', 'APK-RESTRICTED-PERMS', `Uses ${restricted.length} Play-restricted permission(s)`, restricted.join(', '), 'Remove them unless core to the app; Google Play requires a declaration form and may reject the app.'));
  if (dangerous.length > 6) findings.push(f('low', 'APK-MANY-PERMS', `Requests ${dangerous.length} sensitive permissions`, dangerous.join(', '), 'Request only what each feature needs, at the moment it is used.'));

  // Signing
  onProgress('Checking signature and native libraries…');
  const names = [...zip.entries.keys()];
  const v1 = names.filter((n) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(n));
  const blockTail = await bytesOf(zip.blob.slice(Math.max(0, zip.cdOffset - 16), zip.cdOffset));
  const v2plus = new TextDecoder().decode(blockTail) === 'APK Sig Block 42';
  let debugCert = false;
  if (v1.length) debugCert = latin1(await extract(zip, zip.entries.get(v1[0]))).includes('Android Debug');
  if (!debugCert && v2plus) {
    const sizeBytes = await bytesOf(zip.blob.slice(zip.cdOffset - 24, zip.cdOffset - 16));
    const blockSize = Number(new DataView(sizeBytes.buffer).getBigUint64(0, true));
    if (blockSize > 0 && blockSize < 1e7) debugCert = latin1(await bytesOf(zip.blob.slice(zip.cdOffset - blockSize - 8, zip.cdOffset))).includes('Android Debug');
  }
  if (!v1.length && !v2plus) findings.push(f('high', 'APK-UNSIGNED', 'APK is not signed', 'Android will refuse to install it.', 'Sign it with your release key (apksigner / Gradle signingConfig).'));
  if (debugCert) findings.push(f('high', 'APK-DEBUG-CERT', 'Signed with the Android debug certificate', 'Debug keys are shared by every Android Studio install; Play rejects them.', 'Sign with your private release key (or Play App Signing).'));
  if (v1.length && !v2plus && minSdk >= 24) findings.push(f('low', 'APK-V1-ONLY', 'Only the old v1 (JAR) signature is used', 'v1 does not protect the whole file.', 'Enable v2/v3 signing (default in current Gradle).'));

  // Native libraries: 64-bit and 16 KB page size
  const abis = [...new Set(names.map((n) => (/^lib\/([^/]+)\//.exec(n) || [])[1]).filter(Boolean))];
  if (abis.some((x) => x === 'armeabi-v7a' || x === 'x86') && !abis.includes('arm64-v8a')) findings.push(f('high', 'APK-NO-64BIT', 'No 64-bit (arm64-v8a) native libraries', `ABIs: ${abis.join(', ')}`, 'Build arm64-v8a libraries; Google Play requires 64-bit support.'));
  const libs64 = names.filter((n) => /^lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/.test(n));
  const misaligned = [];
  for (const n of libs64.slice(0, 40)) {
    try {
      const align = elfLoadAlignment(await extract(zip, zip.entries.get(n), 4096));
      if (align !== null && align < 16384) misaligned.push(n.split('/').pop());
    } catch { /* skip */ }
  }
  if (misaligned.length) findings.push(f('high', 'APK-16KB-PAGES', `${[...new Set(misaligned)].length} native library(ies) not 16 KB page-aligned`, [...new Set(misaligned)].join(', '), 'Google Play requires 16 KB page size support for apps targeting Android 15+. Update NDK/AGP (r28+/8.5.1+), React Native/Expo/Flutter and native dependencies, then rebuild.'));

  // Framework detection
  const has = (re) => names.some((n) => re.test(n));
  const frameworks = [];
  if (has(/^assets\/index\.android\.bundle$/) || has(/libreactnative|libhermes/)) frameworks.push('React Native');
  if (has(/^assets\/app\.config$|expo/i)) frameworks.push('Expo');
  if (has(/libflutter\.so$/)) frameworks.push('Flutter');
  if (has(/^assets\/(www|public)\/index\.html$/)) frameworks.push(has(/capacitor\.config\.json/) ? 'Capacitor' : 'Cordova / WebView app');
  if (has(/libunity\.so$/)) frameworks.push('Unity');
  if (has(/libmonodroid\.so$|libmonosgen/)) frameworks.push('.NET MAUI / Xamarin');
  if (has(/^kotlin\//)) frameworks.push('Kotlin');
  if (has(/hermes/i) && frameworks.includes('React Native')) frameworks.push('Hermes JS engine');

  // Secrets and risky code in dex, JS bundles and assets
  onProgress('Scanning code and assets for secrets…');
  const scanTargets = [...zip.entries.values()].filter((e) =>
    (/^classes\d*\.dex$/.test(e.name) && e.size < 64e6)
    || (/^assets\/.*\.(bundle|js|json|properties|xml|txt|cfg|conf|env|yaml|yml)$/i.test(e.name) && e.size < 20e6)
    || (/^res\/raw\//.test(e.name) && e.size < 5e6));
  const secretHits = new Map();
  const codeHits = new Set();
  const httpHosts = new Set();
  const firebaseDbs = new Set();
  for (const e of scanTargets.slice(0, 60)) {
    let text;
    try { text = latin1(await extract(zip, e)); } catch { continue; }
    for (const [sev, label, re] of SECRET_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const key = `${label}|${m[0]}`;
        if (!secretHits.has(key)) secretHits.set(key, { sev, label, value: redact(m[0]), file: e.name });
      }
    }
    for (const [, label, re] of CODE_PATTERNS) if (re.test(text)) codeHits.add(label);
    for (const m of text.matchAll(/http:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:"'\s?]|$)/gi)) if (!IGNORE_HTTP.test(m[1])) httpHosts.add(m[1].toLowerCase());
    for (const m of text.matchAll(/https:\/\/([a-z0-9-]+)\.firebaseio\.com|https:\/\/([a-z0-9-]+)-default-rtdb\.[a-z0-9-]+\.firebasedatabase\.app/gi)) firebaseDbs.add(m[0]);
  }
  const byLabel = {};
  for (const h of secretHits.values()) (byLabel[h.label] ||= { sev: h.sev, items: [] }).items.push(`${h.value} (${h.file})`);
  for (const [label, { sev, items }] of Object.entries(byLabel)) {
    const google = label.startsWith('Google');
    findings.push(f(sev, 'APK-SECRET', google ? `${items.length} Google/Firebase API key(s) in the app` : `Possible ${label} hardcoded in the app`, items.slice(0, 6).join('\n'),
      google ? 'Normal for Firebase/Maps, but restrict each key to your package name + SHA-1 in Google Cloud console → Credentials.' : 'Anyone can extract this from the APK. Revoke/rotate it now, and move the call behind your own server.'));
  }
  for (const [sev, label, , fix] of CODE_PATTERNS) if (codeHits.has(label)) findings.push(f(sev, 'APK-CODE', label, 'Found in compiled code or bundled JavaScript.', fix));
  if (httpHosts.size) findings.push(f('low', 'APK-HTTP-URLS', `${httpHosts.size} plain-HTTP address(es) in the code`, [...httpHosts].slice(0, 12).join(', '), 'Switch these to HTTPS (some may be harmless library references).'));
  if (firebaseDbs.size) findings.push(f('info', 'APK-FIREBASE-DB', 'Firebase Realtime Database URL found', [...firebaseDbs].join(', '), 'Make sure its security rules do not allow public read/write.'));

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((x, y) => order[x.severity] - order[y.severity]);
  const penalty = findings.reduce((s, x) => s + ({ critical: 25, high: 12, medium: 5, low: 2, info: 0 }[x.severity] || 0), 0);

  return {
    kind: 'apk',
    target: fileName,
    checked_at: new Date().toISOString(),
    score: Math.max(0, Math.round(100 - penalty * 100 / (penalty + 100))),
    app: {
      package: pkg,
      version_name: a(manifest, 'versionName') ?? null,
      version_code: a(manifest, 'versionCode') ?? null,
      min_sdk: minSdk,
      target_sdk: targetSdk,
      compile_sdk: a(manifest, 'compileSdkVersion') ?? manifest.attrs.platformBuildVersionCode ?? null,
      size_mb: Math.round(file.size / 1048576 * 10) / 10,
      dex_files: names.filter((n) => /^classes\d*\.dex$/.test(n)).length,
      abis,
      frameworks,
      signing: { v1: v1.length > 0, v2_or_later: v2plus, debug_certificate: debugCert },
      permissions: short,
      deep_links: deepLinks.map((d) => d.link).slice(0, 20),
      components: { activities: all(app, 'activity').length, services: all(app, 'service').length, receivers: all(app, 'receiver').length, providers: all(app, 'provider').length },
    },
    findings,
  };
}
