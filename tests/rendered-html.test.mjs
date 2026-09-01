import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) chunks.push(await readSourceTree(child));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) chunks.push(await readFile(child, "utf8"));
  }

  return chunks.join("\n");
}

test("renders the Almadina Express Arabic login application", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const [html, auth] = await Promise.all([
    response.text(),
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<html[^>]+lang="ar"[^>]+dir="rtl"/i);
  assert.match(html, /المدينة إكسبرس/);
  assert.match(html, /ALMADINA EXPRESS/);
  assert.match(html, /جارٍ التحقق من الجلسة الآمنة/);
  assert.match(html, /session-loading/);
  assert.match(auth, /تسجيل الدخول/);
  assert.match(auth, /الحسابات المتاحة/);
  assert.match(auth, /تتبّع طردك بدون تسجيل دخول/);
  assert.match(auth, /أنشئ حسابًا جديدًا/);
  assert.doesNotMatch(auth, /الدخول التجريبي/);
  assert.doesNotMatch(auth, /الحسابات المسجلة/);
  assert.doesNotMatch(html, /Starter Project/);
  assert.doesNotMatch(html, /name="codex-preview"/);
});

test("starts with only the administrator and removes all persisted demonstration accounts and records", async () => {
  const [data, server, auth, readme] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(data, /users:\s*\[admin\]/);
  assert.match(data, /orders:\s*\[\]/);
  assert.match(data, /recipients:\s*\[\]/);
  assert.match(data, /collections:\s*\[\]/);
  assert.match(data, /nextCollection:\s*618000/);
  assert.match(data, /notices:\s*\[\]/);
  assert.match(data, /export function removeLegacyDemoData\(database: Database & \{ compensations\?: unknown\[\] \}\)/);
  assert.match(server, /removeLegacyDemoData\(JSON\.parse\(row\.payload\) as Database\)/);
  assert.doesNotMatch(data, /amir@example\.com|naseem@example\.com|courier@example\.com/);
  assert.doesNotMatch(auth, /الدخول التجريبي|الحسابات المسجلة|loginAs/);
  assert.doesNotMatch(readme, /amir@example\.com|naseem@example\.com/);
});

test("keeps account switching and all merchant-facing records private to the signed-in owner", async () => {
  const [application, context, server, dashboard, shell, management, admin, settings] = await Promise.all([
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(application, /database\.users\.filter\(\(entry\) => entry\.role === "admin"/);
  assert.doesNotMatch(application, /loginAs/);
  assert.doesNotMatch(context, /loginAs/);
  assert.match(application, /لحماية خصوصيتك، سجّل الخروج ثم أدخل بيانات الحساب الآخر/);
  assert.match(server, /verifyPassword\(password, account\.password\)/);
  assert.match(server, /users:\s*\[publicAccount\(account\)\]/);
  assert.match(dashboard, /item\.id === selectedOrderId && \(user\?\.role === "admin" \|\| item\.merchantId === user\?\.id\)/);
  assert.match(dashboard, /notice\.userId === user\?\.id\)\.map/);
  assert.match(shell, /notice\.userId === user\?\.id && !notice\.read/);
  assert.match(management, /const notices = database\.notices\.filter\(\(notice\) => notice\.userId === user\?\.id\)/);
  assert.match(management, /entry\.id === notice\.id && entry\.userId === user\?\.id/);
  assert.match(admin, /notices: current\.notices\.filter\(\(notice\) => notice\.userId !== user\.id\)/);
  assert.match(settings, /setView\("delete-account"\)/);
  assert.doesNotMatch(settings, /onConfirm: \(\) => \{ updateDatabase/);
  assert.match(server, /collections: database\.collections\.filter\(\(invoice\) => invoice\.merchantId === account\.id\)/);
});

test("stores accounts centrally in D1 and authenticates devices using encrypted server sessions", async () => {
  const [manifest, schema, worker, server, application, auth, data] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(manifest).d1, "DB");
  assert.match(schema, /sqliteTable\("almadina_state"/);
  assert.match(schema, /sqliteTable\("almadina_sessions"/);
  assert.match(worker, /handleAlmadinaApi\(request, env\.DB\)/);
  assert.match(server, /PBKDF2/);
  assert.match(server, /HttpOnly; SameSite=Lax/);
  assert.match(server, /orders: database\.orders\.filter\(\(order\) => order\.merchantId === account\.id\)/);
  assert.match(application, /sharedRequest\("session"\)/);
  assert.match(application, /sharedRequest\("register"/);
  assert.match(application, /sharedRequest\("login"/);
  assert.match(application, /window\.setInterval\(\(\) => \{ void synchronize\(\); \}, 6_000\)/);
  assert.match(auth, /await login\(email, password\)/);
  assert.match(auth, /await register\(/);
  assert.doesNotMatch(application, /readDatabase|writeDatabase|localStorage\.setItem\([^)]*database/);
  assert.doesNotMatch(data, /export function readDatabase|export function writeDatabase/);
});

test("includes a GitHub-to-Render deployment with PostgreSQL and a health check", async () => {
  const [blueprint, renderWorker, postgresAdapter, viteConfig, server, readme, packageFile] = await Promise.all([
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../worker/render.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/postgres-d1-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageFile);

  assert.match(blueprint, /type:\s*web/);
  assert.match(blueprint, /runtime:\s*node/);
  assert.match(blueprint, /buildCommand:\s*npm ci --include=dev && npm run build/);
  assert.match(blueprint, /healthCheckPath:\s*\/health/);
  assert.match(blueprint, /key:\s*DEPLOY_TARGET\s*\n\s*value:\s*render/);
  assert.match(blueprint, /key:\s*VINEXT_TRUST_PROXY\s*\n\s*value:\s*["']?1["']?/);
  assert.match(blueprint, /key:\s*DATABASE_URL\s*\n\s*fromDatabase:/);
  assert.match(blueprint, /postgresMajorVersion:\s*["']18["']/);
  assert.match(blueprint, /ipAllowList:\s*\[\]/);
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(blueprint, /key:\s*NODE_ENV/);

  assert.match(renderWorker, /url\.pathname === ["']\/health["']/);
  assert.match(renderWorker, /env\?\.DB \?\? getRenderDatabase\(\)/);
  assert.match(renderWorker, /SELECT 1 AS ok/);
  assert.match(postgresAdapter, /new Pool\(/);
  assert.match(postgresAdapter, /DATABASE_URL/);
  assert.match(postgresAdapter, /result\.rowCount \?\? 0/);
  assert.match(postgresAdapter, /client\.query\(["']BEGIN["']\)/);
  assert.match(postgresAdapter, /client\.query\(["']COMMIT["']\)/);
  assert.match(postgresAdapter, /client\.query\(["']ROLLBACK["']\)/);
  assert.match(viteConfig, /process\.env\.DEPLOY_TARGET === ["']render["']/);
  assert.match(viteConfig, /isRenderBuild \? ["']\.\/worker\/render\.ts["'] : ["']\.\/worker\/index\.ts["']/);
  assert.match(server, /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(typeof manifest.dependencies.pg, "string");
  assert.equal(typeof manifest.dependencies.vinext, "string");
  assert.match(readme, /git push -u origin main/);
  assert.match(readme, /New \+ → Blueprint/);
  assert.match(readme, /30 يومًا/);
});

test("keeps the selected theme consistent before login, inside the account, and after logout", async () => {
  const [application, auth, settings] = await Promise.all([
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(application, /const THEME_STORAGE_KEY = "almadina-express-theme"/);
  assert.match(application, /const \[activeTheme, setActiveTheme\] = useState<ThemePreference>/);
  assert.match(application, /const preferences = \{ \.\.\.storedPreferences, theme: activeTheme \}/);
  assert.match(application, /storedThemePreference\.current = values\.theme/);
  assert.match(application, /setActiveTheme\(values\.theme\)/);
  assert.match(application, /setAnonymousPreferences\(\(current\) => \(\{ \.\.\.current, theme: values\.theme!/);
  assert.match(application, /localStorage\.setItem\(THEME_STORAGE_KEY, values\.theme\)/);
  assert.match(application, /if \(!storedThemePreference\.current && isThemePreference\(accountTheme\)\)/);
  assert.match(auth, /updatePreferences\(\{ theme: "dark" \}\)/);
  assert.match(settings, /updatePreferences\(\{ theme: theme\.id \}\)/);
});

test("shows a safe available-accounts picker and still requires the password", async () => {
  const [auth, application, availableAccounts, styles] = await Promise.all([
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/available-accounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(availableAccounts, /almadina-express-available-accounts-v1/);
  assert.match(availableAccounts, /localStorage\.setItem\(AVAILABLE_ACCOUNTS_STORAGE_KEY/);
  assert.match(availableAccounts, /\.sort\(\(first, second\) => second\.lastUsedAt\.localeCompare\(first\.lastUsedAt\)\)/);
  assert.match(availableAccounts, /\.slice\(0, 8\)/);
  assert.doesNotMatch(availableAccounts, /\bpassword\b|token|session|Database/);
  assert.match(application, /rememberAvailableAccount\(\{ id: account\.id, name: account\.name, email: account\.email, store: account\.store, role: account\.role, avatarColor: account\.avatarColor \}\)/);
  assert.doesNotMatch(application, /rememberAvailableAccount\(account\)/);
  assert.match(auth, /className="available-accounts-button"/);
  assert.match(auth, /disabled=\{availableAccounts\.length === 0\}/);
  assert.match(auth, /<strong>الحسابات المتاحة<\/strong>/);
  assert.match(auth, /لا توجد حسابات مسجلة على هذا الجهاز/);
  assert.match(auth, /setAccountsOpen\(true\)/);
  assert.match(auth, /<Modal title="الحسابات المتاحة"/);
  assert.match(auth, /availableAccounts\.map\(\(account\)/);
  assert.match(auth, /setEmail\(account\.email\)/);
  assert.match(auth, /setPassword\(""\)/);
  assert.match(auth, /لا يتم حفظ كلمات المرور/);
  assert.match(styles, /\.available-accounts-button\s*\{\s*display:\s*none/);
  assert.match(styles, /\.available-accounts-button:disabled\s*\{/);
  assert.match(styles, /\.available-accounts-modal\s*\{/);
  assert.match(styles, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.available-accounts-button\s*\{\s*display:\s*grid/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.available-accounts-button/);
});

test("gates secure mobile biometric unlock behind an encrypted four-digit app lock", async () => {
  const [application, context, settings, screen, client, server, schema, packageFile, styles] = await Promise.all([
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/app-lock-screen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-lock-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageFile);

  assert.equal(typeof manifest.dependencies["@simplewebauthn/browser"], "string");
  assert.equal(typeof manifest.dependencies["@simplewebauthn/server"], "string");
  assert.match(schema, /sqliteTable\("almadina_app_locks"/);
  assert.match(schema, /sqliteTable\("almadina_webauthn_credentials"/);
  assert.match(schema, /sqliteTable\("almadina_webauthn_challenges"/);
  assert.match(server, /pin_hash TEXT NOT NULL/);
  assert.match(server, /APP_LOCK_MAX_FAILED_ATTEMPTS = 5/);
  assert.match(server, /await verifyPassword\(pin, lock\.pin_hash\)/);
  assert.match(server, /authenticatorAttachment: "platform"/);
  assert.match(server, /userVerification: "required"/);
  assert.match(server, /requireUserVerification: true/);
  assert.match(server, /DELETE FROM almadina_webauthn_challenges WHERE session_hash/);
  assert.match(client, /window\.isSecureContext/);
  assert.match(client, /navigator\.maxTouchPoints > 0/);
  assert.match(client, /shortestScreenSide > 1024/);
  assert.match(client, /platformAuthenticatorIsAvailable\(\)/);
  assert.match(settings, /!appLock\.enabled/);
  assert.match(settings, /setPinMode\(value \? "setup" : "disable-lock"\)/);
  assert.match(settings, /disabled=\{!appLock\.ready \|\| !appLock\.enabled/);
  assert.doesNotMatch(settings, /updatePreferences\(\{ pin:/);
  assert.match(application, /restoredLock = \{ \.\.\.status, ready: true, locked: status\.enabled/);
  assert.match(application, /appLock\.locked \? <AppLockScreen \/> : <ApplicationShell \/>/);
  assert.match(application, /BACKGROUND_LOCK_DELAY = 15_000/);
  assert.match(context, /enableBiometricUnlock/);
  assert.match(screen, /تسجيل الخروج واستخدام كلمة المرور/);
  assert.match(styles, /\.app-lock-screen/);
  assert.match(styles, /\.toggle:disabled/);
});

test("keeps merchant and courier account fields read-only while administrators manage them", async () => {
  const [management, admin, server, settings, styles, application] = await Promise.all([
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(management, /const canEdit = user\?\.role === "admin"/);
  assert.equal((management.match(/readOnly=\{!canEdit\}/g) ?? []).length, 4);
  assert.match(management, /\{canEdit && <Button type="submit" icon="check" full>حفظ التغييرات<\/Button>\}/);
  assert.doesNotMatch(management, /لا يمكن تعديل بيانات الحساب/);
  assert.equal((server.match(/const savedAccount = account;/g) ?? []).length, 2);
  assert.match(server, /users: current\.users\.map\(\(entry\) => entry\.id === account\.id \? savedAccount : entry\)/);
  assert.match(server, /const email = candidate\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(server, /البريد الإلكتروني مسجل لحساب آخر/);
  assert.match(admin, /type AccountEditor =/);
  assert.match(admin, /function openAccountEditor\(account: User\)/);
  assert.match(admin, /function saveAccount\(event: FormEvent\)/);
  assert.match(admin, /className="admin-account-edit"/);
  assert.match(admin, /className="admin-account-edit-modal"/);
  assert.match(admin, /المسؤول فقط يستطيع حفظ التغييرات على بيانات هذا الحساب/);
  assert.match(settings, /بيانات حسابك للعرض فقط/);
  assert.match(settings, /لا يغيّر بيانات الحساب إلا المسؤول من لوحة الإدارة/);
  assert.doesNotMatch(styles, /\.profile-readonly__notice/);
  assert.match(styles, /\.profile-readonly \.field__control input:read-only/);
  assert.match(styles, /\.admin-account-edit-modal/);
  assert.match(application, /function rememberSnapshotAccount\(snapshot: SharedSnapshot\)/);
});

test("keeps Excel importing in the desktop toolbar instead of the navigation drawer", async () => {
  const shell = await readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const drawer = shell.split("function NavigationDrawer")[1].split("function GlobalSearch")[0];
  const toolbar = shell.split("function TopBar")[1].split("function BottomNavigation")[0];

  assert.doesNotMatch(drawer, /view:\s*"import"/);
  assert.match(toolbar, /className="topbar__import"/);
  assert.match(toolbar, /name="spreadsheet"/);
  assert.match(toolbar, /استيراد Excel/);
  assert.match(styles, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.topbar__import\s*\{\s*display:\s*none/);
  assert.match(styles, /\.bottom-nav\s*\{[^}]*width:\s*100%/);
});

test("hides the notification bell from the administrator while keeping it for users", async () => {
  const shell = await readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8");
  const topbar = shell.split("function TopBar")[1].split("function BottomNavigation")[0];

  assert.equal((topbar.match(/name="bell"/g) ?? []).length, 1);
  assert.match(topbar, /\{user\?\.role !== "admin"\s*&&\s*<IconButton name="bell" label="الإشعارات" badge=\{unread\} onClick=\{\(\) => setView\("notifications"\)\} \/>\}/);
});

test("replaces compensation requests with responsive collection invoices and verification codes", async () => {
  const [shell, management, settings, styles, icon, admin, context, application, server, data] = await Promise.all([
    readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/icon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(`${shell}\n${management}\n${settings}`, /المرتجعات|مرتجعات/);
  assert.match(shell, /label:\s*"الرواجع"/);
  assert.match(shell, /label:\s*"التحصيلات"/);
  assert.match(shell, /view:\s*"collections"/);
  assert.match(shell, /icon:\s*"receipt"/);
  assert.match(management, /title="الرواجع"/);
  assert.match(management, /export function CollectionsPage\(\)/);
  assert.match(management, /title="التحصيلات"/);
  assert.match(management, /إنشاء فاتورة/);
  assert.match(management, /className="collection-detail-modal"/);
  assert.match(management, /className="verification-modal"/);
  assert.match(management, /className="verification-modal__header"/);
  assert.match(management, />كود التحقق<\/Button>/);
  assert.match(management, /<strong>مستلم مفوض<\/strong>/);
  assert.match(management, /placeholder="الاسم"/);
  assert.doesNotMatch(management, /selectedInvoice\.status === "ready" && <div className="collection-detail__action"/);
  assert.match(data, /status:\s*[^;]*"shipped"/);
  assert.match(data, /verifiedAt\?: string/);
  assert.match(data, /verifiedById\?: string/);
  assert.match(data, /verifiedByName\?: string/);
  assert.match(data, /shippedAt\?: string/);
  assert.match(context, /verifyCollectionCode:\s*\(invoiceId: string, verificationCode: string\) => Promise<boolean>/);
  assert.match(application, /sharedRequest\("collections\/verify"/);
  assert.match(application, /body:\s*JSON\.stringify\(\{ invoiceId, verificationCode \}\)/);
  assert.match(server, /url\.pathname === ["']\/api\/almadina\/collections\/verify["']/);
  assert.match(server, /verificationCode/);
  assert.match(server, /status:\s*"shipped"/);
  assert.match(server, /verifiedById:/);
  assert.match(server, /verifiedByName:/);
  assert.match(server, /shippedAt:/);
  assert.match(admin, /verifyCollectionCode/);
  assert.match(admin, />(?:قراءة|إدخال) كود التحقق<\/Button>/);
  assert.match(admin, /<Modal title="[^"]*كود التحقق[^"]*"/);
  assert.match(admin, /inputMode="numeric"/);
  assert.match(admin, /maxLength=\{4\}/);
  assert.match(admin, /(?:تحقق وشحن التحصيل|تأكيد وجعلها مشحون)/);
  assert.match(admin, /"مشحون"/);
  assert.doesNotMatch(admin, /updateCollection\(invoice\.id, "paid"\)/);
  assert.match(styles, /\.collection-card\s*\{[^}]*grid-template-columns:/);
  assert.match(styles, /\.collection-detail-modal\s*\{[^}]*max-height:/);
  assert.match(styles, /\.verification-modal__header\s*\{[^}]*linear-gradient/);
  assert.match(styles, /\.verification-code\s*\{[^}]*background:\s*#303a3a/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.collection-detail-modal\s*\{\s*width:\s*100%/);
  assert.match(icon, /receipt:\s*<>/);
  assert.doesNotMatch(`${shell}\n${management}\n${settings}`, /التعويضات|طلب تعويض/);
});

test("lets courier employees scan a ready parcel with the camera and mark it shipped", async () => {
  const [application, context, shell, admin, employee, dashboard, orderForm, server, data, styles, appSources] = await Promise.all([
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/employee.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readSourceTree(new URL("../app/", import.meta.url)),
  ]);

  assert.match(data, /export type Role = [^;]*"courier"/);
  assert.match(admin, /<option value="courier">(?:موظف|مندوب توصيل)<\/option>/);
  assert.match(appSources, /(?:user|account)(?:\?|)\.role === "courier"/);
  assert.match(appSources, /(?:موظف|مندوب)[\s\S]{0,180}(?:مسح|كاميرا)|(?:مسح|كاميرا)[\s\S]{0,180}(?:موظف|مندوب)/);
  assert.match(appSources, /مسح (?:كود|رمز) الطرد(?: بالكاميرا)?/);
  assert.match(appSources, /openScanner\(/);
  assert.match(application, /import\("@zxing\/browser"\)/);
  assert.match(application, /BrowserQRCodeReader/);
  assert.match(application, /decodeFromConstraints/);
  assert.match(application, /facingMode:\s*\{ ideal: "environment" \}/);
  assert.match(application, /controls\?\.stop\(\)/);
  assert.match(application, /handledRef\.current/);
  assert.doesNotMatch(application, /BarcodeDetector/);
  assert.match(context, /scan[^:\n]*Parcel|scan[^:\n]*Order|mark[^:\n]*Shipped/i);
  assert.match(application, /sharedRequest\("orders\/scan"/);
  assert.match(application, /body:\s*JSON\.stringify\(\{ trackingNumber \}\)/);
  assert.match(server, /url\.pathname === ["']\/api\/almadina\/orders\/scan["']/);
  assert.match(server, /session\.account\.role !== "courier"/);
  assert.match(server, /invoice|trackingNumber/);
  assert.match(server, /status !== "ready"/);
  assert.match(server, /status:\s*"shipped"/);
  assert.match(server, /courierName:\s*(?:employee|account)\.name/);
  assert.match(server, /appendOrderTrackingEvent|createTrackingEvent/);
  assert.match(server, /notices:/);
  assert.match(server, /order\.courierId === account\.id/);
  assert.doesNotMatch(server, /courierName === account\.name/);
  assert.match(server, /function orderForCourier\(order: Order\)/);
  assert.match(server, /filter\(\(event\) => event\.kind !== "note"\)/);
  assert.match(server, /courierId:\s*undefined/);
  assert.match(server, /shippedAt:\s*undefined/);
  assert.match(server, /collections:\s*\[\]/);
  assert.match(server, /recipients:\s*\[\]/);
  assert.match(employee, /order\.notes/);
  assert.match(employee, /تعليمات المندوب/);
  assert.doesNotMatch(employee, /order\.privateNotes/);
  assert.match(dashboard, /user\?\.role === "admin" && order\.privateNotes/);
  assert.match(dashboard, /الملاحظة الخاصة للمسؤول/);
  assert.doesNotMatch(dashboard, /order\.notes/);
  assert.match(orderForm, /label="التعليمات \(تظهر للمندوب فقط\)"[\s\S]*?value=\{form\.notes\}/);
  assert.match(orderForm, /label="الملاحظة الخاصة \(تظهر للمسؤول فقط\)"[\s\S]*?value=\{form\.privateNotes\}/);
  assert.match(server, /orderWithoutCourierInstructions\(order, true\)/);
  assert.match(server, /orderWithoutCourierInstructions\(order, false\)/);
  assert.match(shell, /role === "courier"/);
  assert.match(styles, /employee|courier/i);
  assert.doesNotMatch(appSources, /openCollectionScanner/);
});

test("lets administrators switch merchants between standard and premium accounts", async () => {
  const [admin, data, server, application, dashboard, styles] = await Promise.all([
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(data, /export type Membership = "standard" \| "premium"/);
  assert.match(admin, /function changeMembership\(account: User, membership: Membership\)/);
  assert.match(admin, /changeMembership\(user, "standard"\)/);
  assert.match(admin, /changeMembership\(user, "premium"\)/);
  assert.match(admin, /role="group" aria-label=\{`تغيير نوع حساب/);
  assert.match(admin, /<option value="premium">بريميوم<\/option>/);
  assert.match(server, /membership:\s*"standard"/);
  assert.match(application, /sharedRequest\("database"/);
  assert.match(dashboard, /membership-badge--\$\{user\?\.membership/);
  assert.match(styles, /\.membership-switch__option--premium\.is-selected/);
});

test("preserves ₪25 West Bank, ₪35 Jerusalem, and ₪80 interior standard delivery prices", async () => {
  const [data, orderForm, management] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
  ]);

  const regions = [...data.matchAll(/\{ name: "([^"]+)", fee: (\d+), cities:/g)]
    .map((match) => ({ name: match[1], fee: Number(match[2]) }));

  assert.ok(regions.length >= 12);
  assert.equal(regions.find((region) => region.name === "القدس")?.fee, 35);
  assert.equal(regions.find((region) => region.name === "الداخل")?.fee, 80);
  assert.ok(regions.filter((region) => region.name !== "القدس" && region.name !== "الداخل").every((region) => region.fee === 25));
  assert.match(data, /standard:\s*\{\s*westBank:\s*25,\s*jerusalem:\s*35,\s*interior:\s*80\s*\}/);
  assert.match(orderForm, /الضفة <strong>\{membershipPrices\.westBank\} ₪<\/strong>/);
  assert.match(orderForm, /القدس <strong>\{membershipPrices\.jerusalem\} ₪<\/strong>/);
  assert.match(orderForm, /الداخل <strong>\{membershipPrices\.interior\} ₪<\/strong>/);
  assert.match(management, /deliveryFee:\s*getDeliveryFee\(region \?\? governorates\[0\], user\.membership\) \+ weightFee \+ oversizeFee/);
});

test("automatically applies ₪20 West Bank, ₪30 Jerusalem, and ₪65 interior premium delivery prices", async () => {
  const [data, orderForm, management] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(data, /premium:\s*\{\s*westBank:\s*20,\s*jerusalem:\s*30,\s*interior:\s*65\s*\}/);
  assert.match(data, /membership === "premium" \? "premium" : "standard"/);
  assert.match(data, /if \(region\.name === "القدس"\) return prices\.jerusalem/);
  assert.match(data, /if \(region\.name === "الداخل"\) return prices\.interior/);
  assert.match(data, /return prices\.westBank/);
  assert.match(orderForm, /getMembershipPrices\(user\?\.membership\)/);
  assert.match(orderForm, /getDeliveryFee\(region, user\?\.membership\)/);
  assert.match(orderForm, /resolveDeliveryRegion\(form\.governorate, form\.city\)/);
  assert.match(orderForm, /أسعار بريميوم/);
  assert.match(management, /getDeliveryFee\(region \?\? governorates\[0\], user\.membership\) \+ weightFee \+ oversizeFee/);
});

test("allows freely typing the parcel governorate and city while resolving regional delivery prices", async () => {
  const [data, orderForm] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
  ]);

  const deliveryAddress = orderForm.split('<SectionCard title="عنوان التوصيل"')[1].split('<SectionCard title="تفاصيل الطرد"')[0];

  assert.match(data, /export function resolveDeliveryRegion\(governorate: string, city = ""\)/);
  assert.match(data, /location\.includes\("القدس"\)/);
  assert.match(data, /location\.includes\("الداخل"\)/);
  assert.match(data, /return matchingCity \?\? governorates\[0\]/);
  assert.match(deliveryAddress, /<Field label="المحافظة" placeholder="اكتب المحافظة، مثلًا: الخليل أو القدس"/);
  assert.match(deliveryAddress, /<Field label="المدينة أو المنطقة" placeholder="اكتب المدينة أو المنطقة"/);
  assert.doesNotMatch(deliveryAddress, /<SelectField label="المحافظة"|<SelectField label="المدينة أو المنطقة"|<option/);
  assert.match(orderForm, /form\.governorate\.trim\(\) \|\| !form\.city\.trim\(\)/);
  assert.match(orderForm, /city: form\.city\.trim\(\)/);
});

test("subtracts the selected regional delivery fee from the parcel price in the contents value", async () => {
  const [orderForm, dashboard] = await Promise.all([
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(orderForm, /const baseDeliveryFee = getDeliveryFee\(region, user\?\.membership\)/);
  assert.match(orderForm, /const selectedWeightFee = getWeightFee\(form\.weight\)/);
  assert.match(orderForm, /const dimensionOversizeFee = getOversizeFee\(form\.length, form\.width, form\.height\)/);
  assert.match(orderForm, /const weightFee = region \? selectedWeightFee : 0/);
  assert.match(orderForm, /const oversizeFee = region \? dimensionOversizeFee : 0/);
  assert.match(orderForm, /const deliveryFee = region \? baseDeliveryFee \+ weightFee \+ oversizeFee : 0/);
  assert.match(orderForm, /const contentValue = Math\.max\(amount - deliveryFee, 0\)/);
  assert.match(orderForm, /const totalCollection = amount/);
  assert.match(orderForm, /label="قيمة المحتويات بعد خصم التوصيل"/);
  assert.match(orderForm, /value=\{form\.amount \? money\(contentValue\) : ""\}/);
  assert.match(orderForm, /تم خصم \$\{money\(deliveryFee\)\} ₪ للتوصيل/);
  assert.match(orderForm, /<span>رسوم التوصيل الأساسية المخصومة<\/span><strong>- \{money\(baseDeliveryFee\)\} ₪<\/strong>/);
  assert.match(orderForm, /<span>رسوم الوزن الإضافية<\/span><strong>- \{money\(weightFee\)\} ₪<\/strong>/);
  assert.match(orderForm, /<span>رسوم الحجم الإضافية<\/span><strong>- \{money\(oversizeFee\)\} ₪<\/strong>/);
  assert.match(orderForm, /<span>قيمة المحتويات بعد الخصم<\/span><strong>\{money\(contentValue\)\} ₪<\/strong>/);
  assert.match(dashboard, /money\(Math\.max\(order\.amount - order\.deliveryFee, 0\)\)/);
  assert.match(dashboard, /order\.deliveryFee - weightFee - oversizeFee/);
});

test("adds progressive weight and dimension fees while keeping legacy imports compatible", async () => {
  const [data, orderForm, server, dashboard, management, download, styles] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/download.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(data, /OVERSIZE_DIMENSION_LIMIT_CM = 40/);
  assert.match(data, /OVERSIZE_DIMENSION_STEP_CM = 20/);
  assert.match(data, /OVERSIZE_FEE = 7/);
  assert.match(data, /MAX_OVERSIZE_FEE = 28/);
  assert.match(data, /Math\.ceil\(\(largestDimension - OVERSIZE_DIMENSION_LIMIT_CM\) \/ OVERSIZE_DIMENSION_STEP_CM\)/);
  assert.match(data, /Math\.min\(tier \* OVERSIZE_FEE, MAX_OVERSIZE_FEE\)/);
  assert.match(data, /export const WEIGHT_OPTIONS/);
  assert.match(data, /\{ label: "أكثر من 30 كغم", fee: 20 \}/);
  assert.match(data, /export function getWeightFee/);
  assert.match(data, /weightFee\?: number/);
  assert.match(data, /oversizeFee\?: number/);
  assert.match(data, /lengthCm\?: number/);
  assert.match(data, /export function getOrderOversizeFee/);
  assert.match(data, /export function parseDimensionCm/);
  assert.match(data, /normalizeDigits/);
  assert.match(orderForm, /تزيد الرسوم تدريجيًا \$\{OVERSIZE_FEE\} ₪ لكل \$\{OVERSIZE_DIMENSION_STEP_CM\} سم إضافية/);
  assert.match(orderForm, /className=\{`oversize-fee-notice \$\{dimensionOversizeFee \? "is-active" : ""\}`\}/);
  assert.match(orderForm, /weightFee, oversizeFee/);
  assert.match(orderForm, /oversizeFee:\s*oversizeFee|heightCm: Number\(form\.height\)[\s\S]{0,80}oversizeFee/);
  assert.match(server, /getOrderDimensions\(candidate\)/);
  assert.match(server, /const weight = normalizeWeightOption\(candidate\.weight\)/);
  assert.match(server, /const weightFee = getWeightFee\(weight\)/);
  assert.match(server, /getOrderOversizeFee\(candidate\)/);
  assert.match(server, /getDeliveryFee\(region, savedAccount\.membership\) \+ weightFee \+ oversizeFee/);
  assert.match(dashboard, /رسوم الوزن الإضافية/);
  assert.match(dashboard, /رسوم الحجم الإضافية/);
  assert.match(download, /"الطول سم", "العرض سم", "الارتفاع سم", "الوزن"/);
  assert.match(management, /parseDimensionCm\(row\[6\]\)/);
  assert.match(management, /normalizeWeightOption\(row\[9\]\)/);
  assert.match(management, /getWeightFee\(weight\)/);
  assert.match(management, /getOversizeFee\(lengthCm, widthCm, heightCm\)/);
  assert.match(management, /getDeliveryFee\(region \?\? governorates\[0\], user\.membership\) \+ weightFee \+ oversizeFee/);
  assert.match(management, /رسوم الوزن والحجم تدريجيًا/);
  assert.match(styles, /\.oversize-fee-notice\.is-active/);
});

test("normalizes Arabic and Latin dimension values used by CSV importing", async () => {
  const { getOversizeFee, getWeightFee, normalizeWeightOption, parseDimensionCm } = await import(new URL("../app/lib/data.ts", import.meta.url));

  assert.equal(parseDimensionCm("40"), 40);
  assert.equal(parseDimensionCm("٤٠"), 40);
  assert.equal(parseDimensionCm("٥٠"), 50);
  assert.equal(getOversizeFee(40, 40, 40), 0);
  assert.equal(getOversizeFee(41, 40, 40), 7);
  assert.equal(getOversizeFee(60, 40, 40), 7);
  assert.equal(getOversizeFee(61, 40, 40), 14);
  assert.equal(getOversizeFee(80, 40, 40), 14);
  assert.equal(getOversizeFee(81, 40, 40), 21);
  assert.equal(getOversizeFee(100, 40, 40), 21);
  assert.equal(getOversizeFee(101, 40, 40), 28);
  assert.equal(getOversizeFee(300, 40, 40), 28);
  assert.equal(getOversizeFee(50, 50, 50), 7);
  assert.equal(getOversizeFee("٨١", "٢٠", "٢٠"), 21);
  assert.equal(getWeightFee("0 - 5 كغم"), 0);
  assert.equal(getWeightFee("5 - 10 كغم"), 5);
  assert.equal(getWeightFee("10 - 20 كغم"), 10);
  assert.equal(getWeightFee("20 - 30 كغم"), 15);
  assert.equal(getWeightFee("أكثر من 30 كغم"), 20);
  assert.equal(normalizeWeightOption(undefined), "0 - 5 كغم");
  assert.equal(getWeightFee("قيمة غير صالحة"), 0);
});

test("uses «الطرود» in visible copy while preserving the internal shipments hooks", async () => {
  const [appSources, shell, dashboard, context, styles] = await Promise.all([
    readSourceTree(new URL("../app/", import.meta.url)),
    readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(appSources, /الشحنات|شحنات|الشحنة/);
  assert.match(shell, /label: "الطرود", view: "shipments"/);
  assert.match(shell, /view: "shipments", label: "الطرود"/);
  assert.match(dashboard, /export function Shipments\(\)/);
  assert.match(dashboard, /title="الطرود"/);
  assert.match(context, /"shipments"/);
  assert.match(styles, /\.shipments-page__bulk-print/);
});

test("shows a clear responsive day month year prompt and saves the preferred delivery date", async () => {
  const [data, orderForm, dashboard, styles] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(data, /preferredDeliveryDate\?: string/);
  assert.match(orderForm, /deliveryDate: ""/);
  assert.match(orderForm, /value=\{form\.deliveryDate\}/);
  assert.match(orderForm, /preferredDeliveryDate: form\.deliveryDate \|\| undefined/);
  assert.match(orderForm, /preferred-date-placeholder/);
  assert.match(orderForm, />يوم \/ شهر \/ سنة<\/span>/);
  assert.match(orderForm, /اختر التاريخ من التقويم أو اكتبه بصيغة يوم \/ شهر \/ سنة/);
  assert.match(dashboard, /order\.preferredDeliveryDate\.split\("-"\)\.reverse\(\)\.join\(" \/ "\)/);
  assert.match(styles, /\.preferred-date-control\s*\{[^}]*position:\s*relative/);
  assert.match(styles, /\.preferred-date-placeholder\s*\{[^}]*pointer-events:\s*none/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.preferred-date-placeholder/);
});

test("adds a responsive printable shipping label with a real tracking QR code", async () => {
  const [dashboard, qrCode, styles, icons] = await Promise.all([
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/qr-code.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/icon.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /const \[labelOpen, setLabelOpen\] = useState\(false\)/);
  assert.match(dashboard, /onClick=\{\(\) => setLabelOpen\(true\)\}/);
  assert.match(dashboard, /<strong>ملصق الشحن<\/strong>/);
  assert.match(dashboard, /className="shipping-label-modal"/);
  assert.match(dashboard, /className=\{`shipping-label \$\{bulk \? "shipping-label--bulk" : ""\}`\}/);
  assert.match(dashboard, /<ShippingQr value=\{order\.trackingNumber\} \/>/);
  assert.match(dashboard, /التحصيل \(COD\)/);
  assert.match(dashboard, /طباعة الملصق/);
  assert.match(dashboard, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(qrCode, /const SIZE = 21/);
  assert.match(qrCode, /const DATA_CODEWORDS = 19/);
  assert.match(qrCode, /const ECC_CODEWORDS = 7/);
  assert.match(qrCode, /export function createQrMatrix\(value: string\)/);
  assert.match(styles, /\.shipping-label-modal\s*\{[^}]*max-height:/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.shipping-label-modal\s*\{\s*width:\s*100%/);
  assert.match(styles, /@media print\s*\{[\s\S]*?body:has\(\.shipping-label-modal\) \.application\s*\{\s*display:\s*none/);
  assert.match(icons, /qrCode:\s*<>/);
});

test("lets the merchant select exactly which parcels are included in the responsive bulk print job", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /const \[bulkPrintOpen, setBulkPrintOpen\] = useState\(false\)/);
  assert.match(dashboard, /const printableOrders = useMemo\(\(\) => database\.orders\.filter\(\(order\) => order\.merchantId === user\?\.id && !order\.deleted\)/);
  assert.match(dashboard, /طباعة الكل/);
  assert.match(dashboard, /className="shipments-page__bulk-print"/);
  assert.match(dashboard, /disabled=\{!printableOrders\.length\}/);
  assert.match(dashboard, /<BulkShippingLabelsModal orders=\{printableOrders\} onClose=/);
  assert.match(dashboard, /const \[selectedOrderIds, setSelectedOrderIds\] = useState<Set<string>>/);
  assert.match(dashboard, /new Set\(orders\.map\(\(order\) => order\.id\)\)/);
  assert.match(dashboard, /const selectedOrders = orders\.filter\(\(order\) => selectedOrderIds\.has\(order\.id\)\)/);
  assert.match(dashboard, /const allSelected = orders\.length > 0 && selectedOrders\.length === orders\.length/);
  assert.match(dashboard, /function toggleOrder\(orderId: string\)/);
  assert.match(dashboard, /if \(next\.has\(orderId\)\) next\.delete\(orderId\);\s*else next\.add\(orderId\)/);
  assert.match(dashboard, /function toggleAll\(\)/);
  assert.match(dashboard, /setSelectedOrderIds\(allSelected \? new Set\(\) : new Set\(orders\.map\(\(order\) => order\.id\)\)\)/);
  assert.match(dashboard, /type="checkbox"/);
  assert.match(dashboard, /checked=\{selectedOrderIds\.has\(order\.id\)\}/);
  assert.match(dashboard, /onChange=\{\(\) => toggleOrder\(order\.id\)\}/);
  assert.match(dashboard, /allSelected \? "إلغاء تحديد الكل" : "تحديد الكل"/);
  assert.match(dashboard, /selectedOrders\.length\.toLocaleString\("ar-EG"\)/);
  assert.match(dashboard, /تم تحديد \{selectedCount\} من أصل \{totalCount\}/);
  assert.match(dashboard, /disabled=\{!selectedOrders\.length\}/);
  assert.match(dashboard, /className="bulk-shipping-labels-print"/);
  assert.match(dashboard, /selectedOrders\.map\(\(order\) => <ShippingLabel key=\{order\.id\} order=\{order\} bulk \/>/);
  assert.match(dashboard, /كل طرد في صفحة مستقلة ضمن عملية طباعة واحدة/);
  assert.match(styles, /\.bulk-shipping-labels-modal__selection/);
  assert.match(styles, /\.bulk-shipping-labels-modal__select-all/);
  assert.match(styles, /\.bulk-shipping-labels-modal__checkbox/);
  assert.match(styles, /\.bulk-shipping-labels-modal__preview\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.bulk-shipping-labels-modal__preview > label/);
  assert.match(styles, /\.bulk-shipping-labels-modal__preview > label\.is-selected/);
  assert.match(styles, /\.bulk-shipping-labels-print\s*\{\s*display:\s*none/);
  assert.match(styles, /@media print\s*\{[\s\S]*?body:has\(\.bulk-shipping-labels-modal\) \.bulk-shipping-labels-print\s*\{\s*display:\s*block/);
  assert.match(styles, /\.shipping-label--bulk\s*\{[^}]*break-after:\s*page/);
  assert.match(styles, /\.shipping-label--bulk:last-child\s*\{[^}]*break-after:\s*auto/);
  assert.match(styles, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.shipments-page__bulk-print\s*\{\s*display:\s*none/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.bulk-shipping-labels-modal\s*\{\s*width:\s*100%/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.bulk-shipping-labels-modal__preview > label/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.bulk-shipping-labels-modal__actions/);
});

test("opens every newly created parcel on a persistent responsive tracking history", async () => {
  const [data, orderForm, management, dashboard, history, auth, admin, server, styles] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/order-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/tracking-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/auth.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(data, /export type TrackingEvent = \{/);
  assert.match(data, /trackingEvents\?: TrackingEvent\[\]/);
  assert.match(data, /export function createTrackingEvent\(/);
  assert.match(data, /export function getOrderTrackingEvents\(/);
  assert.match(data, /export function appendOrderTrackingEvent\(/);
  assert.match(data, /export function appendOrderTrackingNote\(/);
  assert.match(data, /kind\?: "status" \| "note"/);
  assert.match(data, /event\.kind = "note"/);
  assert.match(data, /\{ id: "draft", label: "قيد الإنشاء"/);
  assert.match(data, /\{ id: "ready", label: "جاهز للإرسال"/);
  assert.match(orderForm, /status:\s*"draft"/);
  assert.match(orderForm, /trackingEvents:\s*\[createTrackingEvent\("draft"/);
  assert.match(orderForm, /وحالته قيد الإنشاء/);
  assert.match(orderForm, /setSelectedOrderId\(order\.id\);[\s\S]*?setView\("order-detail"\)/);
  assert.match(management, /status:\s*"draft"/);
  assert.match(management, /trackingEvents:\s*\[createTrackingEvent\("draft"/);
  assert.match(dashboard, /useState<"tracking" \| "details">\("tracking"\)/);
  assert.match(dashboard, /label: "التتبّع"/);
  assert.match(dashboard, /label: "تفاصيل الطرد"/);
  assert.match(dashboard, /<TrackingHistory order=\{order\} \/>/);
  assert.match(dashboard, /appendOrderTrackingEvent\(/);
  assert.match(dashboard, /appendOrderTrackingNote\(/);
  assert.match(dashboard, /إضافة ملاحظة للحالة الحالية/);
  assert.match(dashboard, /<TrackingNoteComposer status=\{order\.status\}/);
  assert.match(dashboard, /<Modal title="تحديث حالة الطرد"/);
  assert.match(admin, /appendOrderTrackingEvent\(/);
  assert.match(admin, /<TrackingNoteComposer status=\{statusUpdate\.status\}/);
  assert.match(admin, /ملاحظة اختيارية توضح هذا التحديث للمستخدم/);
  assert.match(history, /getOrderTrackingEvents\(order\)\.reverse\(\)/);
  assert.match(history, /tracking-history__marker/);
  assert.match(history, /الحالة الحالية/);
  assert.match(history, /maxLength=\{500\}/);
  assert.match(history, /ملاحظة مضافة/);
  assert.match(auth, /<TrackingHistory order=\{trackedOrder\} compact \/>/);
  assert.match(server, /getOrderTrackingEvents\(order\)/);
  assert.match(server, /function mergeMerchantTrackingNote\(/);
  assert.match(server, /event\?\.kind === "note" && !savedEventIds\.has\(event\.id\)/);
  assert.match(server, /appendOrderTrackingNote\(existing, account\.name, note\)/);
  assert.doesNotMatch(server, /trackingEvents: candidate\.trackingEvents/);
  assert.match(server, /status:\s*"draft"/);
  assert.match(server, /trackingEvents:\s*\[createTrackingEvent\("draft", savedAccount\.name/);
  assert.match(server, /filter\(\(event\) => event\.kind !== "note"\)/);
  assert.match(server, /createTrackingEvent\(event\.status, "فريق المدينة إكسبرس"/);
  assert.match(styles, /\.tracking-history\s*\{/);
  assert.match(styles, /\.tracking-history__event\s*\{/);
  assert.match(styles, /\.tracking-note-form\s*\{/);
  assert.match(styles, /\.tracking-status-modal\s*\{/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.tracking-history__event/);
});

test("renders dialogs into the document body and keeps collection verification controls outside scrolling content", async () => {
  const [ui, management, styles, icons] = await Promise.all([
    readFile(new URL("../app/components/ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/icon.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(ui, /import \{ createPortal \} from "react-dom"/);
  assert.match(ui, /return createPortal\(/);
  assert.match(ui, /document\.body/);
  assert.match(management, /className="collection-detail__scroll"/);
  assert.match(management, /className="collection-detail__action"/);
  assert.match(styles, /\.collection-detail__scroll\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.collection-detail__action\s*\{[^}]*border-top:/);
  assert.match(icons, /return:\s*<>\s*<rect x="4" y="4" width="16" height="16" rx="4"\/>/);
});

test("lets only the administrator broadcast app-update notifications to membership groups, roles, or one user with optional sound", async () => {
  const [data, context, application, admin, server, styles] = await Promise.all([
    readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(data, /export type NoticeAudience = "all" \| "merchants" \| "couriers" \| "premium" \| "standard" \| "user"/);
  assert.match(context, /broadcastNotice:\s*\(notice:[\s\S]*recipientUserId\?: string[\s\S]*Promise<number \| null>/);
  assert.match(application, /sharedRequest\("notices\/broadcast"/);
  assert.match(application, /broadcastRequestIds\.current\.get\(requestKey\) \?\? uid\("broadcast"\)/);
  assert.match(application, /values\.recipientUserId \?\? ""/);
  assert.match(application, /body:\s*JSON\.stringify\(\{ requestId, \.\.\.values \}\)/);
  assert.match(application, /remoteMutationInFlight\.current = true/);
  assert.match(application, /pendingUpdates\.current\.reduce\(\(current, update\) => update\(current\), snapshot\.database\)/);
  assert.match(application, /<AppContext\.Provider value=\{\{[\s\S]*broadcastNotice/);
  assert.match(application, /knownNoticeIds/);
  assert.match(application, /noticeBaselineUserId/);
  assert.match(application, /playNotificationChime/);
  assert.match(application, /preferences\.notifications && preferences\.sounds/);
  assert.match(application, /newNotices\.some\(\(notice\) => !notice\.read\)/);
  assert.match(application, /knownNoticeIds\.current\.add\(notice\.id\)/);
  assert.match(application, /document\.addEventListener\("pointerdown", unlock/);
  assert.match(admin, />إرسال تحديث<\/Button>/);
  assert.match(admin, /title="إرسال إشعار تحديث"/);
  assert.match(admin, /جميع المستخدمين/);
  assert.match(admin, /التجار فقط/);
  assert.match(admin, /<option value="premium">حسابات البريميوم فقط<\/option>/);
  assert.match(admin, /<option value="standard">الحسابات العادية فقط<\/option>/);
  assert.match(admin, /المندوبون فقط/);
  assert.match(admin, /مستخدم محدد/);
  assert.match(admin, /label="اختر المستخدم"/);
  assert.match(admin, /recipientUserId/);
  assert.match(admin, /audience === "premium" && account\.role === "merchant" && account\.membership === "premium"/);
  assert.match(admin, /audience === "standard" && account\.role === "merchant" && account\.membership !== "premium"/);
  assert.match(admin, /announcement\.audience === "premium" \? merchants\.filter\(\(account\) => account\.membership === "premium"\)\.length/);
  assert.match(admin, /announcement\.audience === "standard" \? merchants\.filter\(\(account\) => account\.membership !== "premium"\)\.length/);
  assert.match(admin, /await broadcastNotice\(/);
  assert.match(server, /session\.account\.role !== "admin"[\s\S]*هذه الميزة متاحة للمسؤول فقط/);
  assert.match(server, /url\.pathname === "\/api\/almadina\/notices\/broadcast"/);
  assert.match(server, /audience !== "premium" && audience !== "standard"/);
  assert.match(server, /audience === "premium" && account\.role === "merchant" && account\.membership === "premium"/);
  assert.match(server, /audience === "standard" && account\.role === "merchant" && account\.membership !== "premium"/);
  assert.match(server, /sha256\(`\$\{requestId\}:\$\{account\.id\}`\)/);
  assert.match(server, /notice\.broadcastId === requestId/);
  assert.match(server, /notice\.title !== title \|\| notice\.message !== message \|\| notice\.audience !== audience \|\| \(audience === "user" && notice\.userId !== recipientUserId\)/);
  assert.match(server, /account\.id === recipientUserId && account\.role !== "admin"/);
  assert.match(server, /المستخدم المحدد غير موجود أو لا يمكن إرسال إشعار إليه/);
  assert.match(server, /notices:\s*\[\.\.\.missingNotices, \.\.\.state\.database\.notices\]/);
  assert.match(server, /if \(!missingNotices\.length\)/);
  assert.match(styles, /\.admin-notification-modal\s*\{/);
  assert.match(styles, /\.admin-notification-message textarea\s*\{/);
  assert.match(styles, /@media \(max-width: 500px\)\s*\{[\s\S]*?\.admin-notification-summary/);
});

test("lets a signed-in account clear only its own selected notifications through the protected server route", async () => {
  const [context, application, management, server, styles] = await Promise.all([
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/management-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(context, /clearNotices:\s*\(noticeIds: string\[\]\) => Promise<number \| null>/);
  assert.match(application, /async function clearNotices\(noticeIds: string\[\]\): Promise<number \| null>/);
  assert.match(application, /sharedRequest\("notices\/clear",\s*\{[\s\S]*method: "POST"[\s\S]*JSON\.stringify\(\{ noticeIds \}\)/);
  assert.match(application, /authoritativeDatabase\.current = snapshot\.database/);
  assert.match(application, /return snapshot\.removedCount \?\? 0/);
  assert.match(application, /<AppContext\.Provider value=\{\{[\s\S]*clearNotices/);
  assert.match(management, /const notices = database\.notices\.filter\(\(notice\) => notice\.userId === user\?\.id\)/);
  assert.match(management, /const visibleNoticeIds = notices\.map\(\(notice\) => notice\.id\)/);
  assert.match(management, /const removedCount = await clearNotices\(noticeIds\)/);
  assert.match(management, /title: "مسح جميع الإشعارات\؟"/);
  assert.match(management, /إشعارات هذا الحساب فقط/);
  assert.match(management, /danger: true/);
  assert.match(management, /className="notification-clear-button"[\s\S]*مسح الكل/);
  assert.match(server, /async function clearNotices\(database: D1Database, request: Request, session: AuthenticatedSession\): Promise<Response>/);
  assert.match(server, /Array\.isArray\(payload\.noticeIds\)[\s\S]*payload\.noticeIds\.length > 5_000/);
  assert.match(server, /const noticeIds = new Set\(payload\.noticeIds\.map/);
  assert.match(server, /state\.database\.users\.find\(\(entry\) => entry\.id === session\.account\.id\)/);
  assert.match(server, /state\.database\.notices\.filter\(\(notice\) => notice\.userId !== account\.id \|\| !noticeIds\.has\(notice\.id\)\)/);
  assert.match(server, /const next: Database = \{ \.\.\.state\.database, notices \}/);
  assert.match(server, /removedCount: 0/);
  assert.match(server, /if \(!session\) return[\s\S]*url\.pathname === "\/api\/almadina\/notices\/clear" && request\.method === "POST"[\s\S]*return await clearNotices\(database, request, session\)/);
  assert.match(styles, /\.notification-page-actions\s*\{/);
  assert.match(styles, /\.notification-clear-button\s*\{[^}]*color:\s*var\(--danger\)/);
});

test("shows a reference-style account deletion page and performs deletion only through the protected server route", async () => {
  const [application, context, server, shell, settings, styles, availableAccounts] = await Promise.all([
    readFile(new URL("../app/almadina-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/app-context.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/server-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/application-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/settings-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/available-accounts.ts", import.meta.url), "utf8"),
  ]);

  assert.match(context, /\| "delete-account"/);
  assert.match(context, /deleteAccount:\s*\(password: string, confirmation: string\) => Promise<boolean>/);
  assert.match(shell, /case "delete-account": return <DeleteAccountPage \/>/);
  assert.match(shell, /view !== "delete-account" && <BottomNavigation \/>/);
  assert.match(settings, /export function DeleteAccountPage\(\)/);
  assert.match(settings, /قبل حذف حسابك/);
  assert.match(settings, /إكمال جميع معاملات التحصيل/);
  assert.match(settings, /ألا توجد طرود نشطة/);
  assert.match(settings, /إدراج كل طرد مكتمل في فاتورة تحصيل مدفوعة/);
  assert.match(settings, /الحذف نهائي وفوري بعد التأكيد/);
  assert.match(settings, /disabled=\{!eligible\}/);
  assert.match(settings, /اكتب «حذف حسابي» للتأكيد/);
  assert.match(settings, /deleteAccount\(password, confirmation\)/);
  assert.doesNotMatch(settings, /users: current\.users\.filter\(\(entry\) => entry\.id !== user\.id\)/);

  assert.match(application, /fetch\("\/api\/almadina\/account\/delete"/);
  assert.match(application, /JSON\.stringify\(\{ password, confirmation \}\)/);
  assert.match(application, /forgetAvailableAccount\(user\.id\)/);
  assert.match(availableAccounts, /export function forgetAvailableAccount\(accountId: string\)/);

  assert.match(server, /async function deleteOwnAccount/);
  assert.match(server, /session\.account\.role === "admin"/);
  assert.match(server, /confirmation !== "حذف حسابي"/);
  assert.match(server, /verifyPassword\(password, account\.password\)/);
  assert.match(server, /accountDeletionEligibility\(state\.database, account\)/);
  assert.match(server, /invoice\.status === "paid"/);
  assert.match(server, /order\.status !== "delivered" && order\.status !== "returned"/);
  assert.match(server, /DELETE FROM almadina_sessions WHERE user_id = \?/);
  assert.match(server, /url\.pathname === "\/api\/almadina\/account\/delete"/);

  assert.match(styles, /\.delete-account-page\s*\{/);
  assert.match(styles, /\.delete-account-requirements\s*\{/);
  assert.match(styles, /\.delete-account-actions\s*\{/);
  assert.match(styles, /\.delete-account-confirmation-modal\s*\{/);
});
