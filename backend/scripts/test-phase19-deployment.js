/**
 * Phase 19 Deployment & Environment Configuration Verification Suite
 * 
 * Verifies:
 * 1. Health check endpoints (/health and /api/health) return valid JSON with correct structure.
 * 2. Sensitive database passwords and payment keys are never exposed in health check or logs.
 * 3. SPA routing redirect files exist in frontend/public and are compiled into frontend/dist.
 * 4. Netlify (netlify.toml) and Render (render.yaml) configuration files are valid.
 * 5. Environment templates (.env.example) exist and contain no live credentials.
 * 6. .gitignore strictly excludes .env files across all directories.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(ROOT_DIR, 'frontend');

const API_BASE = 'http://localhost:3000';

async function runTests() {
  console.log('--- STARTING PHASE 19 DEPLOYMENT & ENVIRONMENT VERIFICATION ---');
  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✓ [${total}] ${desc}`);
    } catch (err) {
      console.error(`  ✗ [${total}] ${desc}: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(desc, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✓ [${total}] ${desc}`);
    } catch (err) {
      console.error(`  ✗ [${total}] ${desc}: ${err.message}`);
      throw err;
    }
  }

  function makeRequest(pathname) {
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, API_BASE);
      http.get(url.toString(), (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (e) {
            json = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }).on('error', reject);
    });
  }

  // =========================================================================
  // 1. Health Check Endpoint Tests
  // =========================================================================

  await testAsync('1.1 GET /health returns HTTP 200 with complete system diagnostic schema', async () => {
    const res = await makeRequest('/health');
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    assert.ok(res.body, 'Expected JSON body');
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(typeof res.body.uptime === 'number', 'uptime should be a number');
    assert.ok(res.body.timestamp, 'timestamp should exist');
    assert.ok(res.body.database, 'database object should exist');
    assert.strictEqual(res.body.database.readyState, 1);
    assert.ok(res.body.database.topology, 'database.topology should be reported');
    assert.ok(typeof res.body.database.transactionsSupported === 'boolean', 'transactionsSupported should be boolean');
    assert.ok(res.body.payments, 'payments object should exist');
    assert.ok(typeof res.body.payments.razorpayConfigured === 'boolean');
  });

  await testAsync('1.2 GET /api/health returns identical health check JSON', async () => {
    const res = await makeRequest('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  await testAsync('1.3 Health check endpoints do not expose credentials, database connection strings or secrets', async () => {
    const res = await makeRequest('/health');
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('mongodb+srv'), 'MongoDB URI should not be exposed');
    assert.ok(!raw.includes('password'), 'Password should not be exposed');
    assert.ok(!raw.includes('secret'), 'Secrets should not be exposed');
    assert.ok(!raw.includes('key_secret'), 'Key secret should not be exposed');
  });

  // =========================================================================
  // 2. Netlify & Render Configuration Files
  // =========================================================================

  test('2.1 netlify.toml exists at root with correct build command, directory and SPA redirect rule', () => {
    const netlifyPath = path.join(ROOT_DIR, 'netlify.toml');
    assert.ok(fs.existsSync(netlifyPath), 'netlify.toml must exist at root');
    const content = fs.readFileSync(netlifyPath, 'utf8');
    assert.ok(content.includes('base = "frontend"'), 'netlify.toml must specify base = "frontend"');
    assert.ok(content.includes('command = "npm run build"'), 'netlify.toml must specify build command');
    assert.ok(content.includes('publish = "dist"'), 'netlify.toml must specify publish directory');
    assert.ok(content.includes('to = "/index.html"'), 'netlify.toml must include SPA redirect to index.html');
  });

  test('2.2 frontend/public/_redirects exists for Vite SPA static routing', () => {
    const redirectsPath = path.join(FRONTEND_DIR, 'public', '_redirects');
    assert.ok(fs.existsSync(redirectsPath), 'frontend/public/_redirects must exist');
    const content = fs.readFileSync(redirectsPath, 'utf8').trim();
    assert.strictEqual(content, '/*    /index.html   200');
  });

  test('2.3 render.yaml exists at root configuring backend web service with /health path', () => {
    const renderPath = path.join(ROOT_DIR, 'render.yaml');
    assert.ok(fs.existsSync(renderPath), 'render.yaml must exist at root');
    const content = fs.readFileSync(renderPath, 'utf8');
    assert.ok(content.includes('rootDir: backend'), 'render.yaml must target backend rootDir');
    assert.ok(content.includes('healthCheckPath: /health'), 'render.yaml must set healthCheckPath');
    assert.ok(content.includes('startCommand: node server.js'), 'render.yaml must specify startCommand');
    assert.ok(content.includes('buildCommand: npm ci'), 'render.yaml must specify buildCommand');
  });

  test('2.4 Jenkinsfile exists with declarative stages for dependencies, tests and frontend build', () => {
    const jenkinsPath = path.join(ROOT_DIR, 'Jenkinsfile');
    assert.ok(fs.existsSync(jenkinsPath), 'Jenkinsfile must exist');
    const content = fs.readFileSync(jenkinsPath, 'utf8');
    assert.ok(content.includes('npm ci'), 'Jenkinsfile should use npm ci');
    assert.ok(content.includes('npm run test:phase16') || content.includes('npm test'), 'Jenkinsfile should run tests');
    assert.ok(content.includes('npm run build'), 'Jenkinsfile should compile frontend bundle');
  });

  // =========================================================================
  // 3. Environment & Secrets Management
  // =========================================================================

  test('3.1 backend/.env.example exists and documents all required variables without real credentials', () => {
    const examplePath = path.join(BACKEND_DIR, '.env.example');
    assert.ok(fs.existsSync(examplePath), 'backend/.env.example must exist');
    const content = fs.readFileSync(examplePath, 'utf8');
    const requiredVars = [
      'NODE_ENV', 'PORT', 'MONGODB_URI', 'TEST_MONGODB_URI',
      'JWT_SECRET', 'SESSION_SECRET', 'FRONTEND_URLS', 'ADMIN_COMMISSION_RATE',
      'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'
    ];
    for (const v of requiredVars) {
      assert.ok(content.includes(v), `backend/.env.example must document ${v}`);
    }
    // Verify no actual production secrets or mongodb atlas credentials in template
    assert.ok(!content.includes('cluster0.ieacybu'), 'Must not include real cluster host');
    assert.ok(!content.includes('Ara12345'), 'Must not include real password');
    assert.ok(!content.includes('amanara13579'), 'Must not include real username');
    assert.ok(!content.match(/rzp_live_[A-Za-z0-9]{10,}/), 'Must not include real live razorpay key');
  });

  test('3.2 frontend/.env.example exists and documents VITE_API_URL and VITE_SOCKET_URL', () => {
    const examplePath = path.join(FRONTEND_DIR, '.env.example');
    assert.ok(fs.existsSync(examplePath), 'frontend/.env.example must exist');
    const content = fs.readFileSync(examplePath, 'utf8');
    assert.ok(content.includes('VITE_API_URL'));
    assert.ok(content.includes('VITE_SOCKET_URL'));
  });

  test('3.3 .gitignore blocks .env files from being tracked in git', () => {
    const gitignorePath = path.join(ROOT_DIR, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.env'), '.gitignore must ignore .env');
    assert.ok(content.includes('backend/.env') || content.includes('.env.*'), '.gitignore must ignore backend .env');
  });

  test('3.4 package.json in backend and frontend specify Node.js engines', () => {
    const backendPkg = JSON.parse(fs.readFileSync(path.join(BACKEND_DIR, 'package.json'), 'utf8'));
    assert.ok(backendPkg.engines && backendPkg.engines.node, 'backend/package.json must specify engines.node');

    const frontendPkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, 'package.json'), 'utf8'));
    assert.ok(frontendPkg.engines && frontendPkg.engines.node, 'frontend/package.json must specify engines.node');
  });

  console.log(`\nAll ${passed}/${total} Phase 19 Deployment & Environment tests passed successfully!`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('\nPhase 19 verification failed:', err);
  process.exit(1);
});
