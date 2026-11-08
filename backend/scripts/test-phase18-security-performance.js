/**
 * Phase 18 Final Targeted Security Verification Suite
 * Tests the three audited security controls:
 * 1. sanitizeNoSql / hasNoSqlOperator:
 *    - Valid product, address, search, and checkout inputs are unmodified.
 *    - Malicious operators ($gt, $ne, $where, field.path) are safely rejected with HTTP 400.
 *    - Full Express 4.x query handling compatibility.
 * 2. isValidImageUrl:
 *    - SVG data URIs are strictly rejected (XSS vector elimination).
 *    - Supported raster formats (jpeg, jpg, png, webp, gif) and https URLs are retained.
 * 3. Authentication Cookie Settings & CSRF:
 *    - SameSite is set to 'lax' rather than 'none'.
 *    - State-changing requests authenticated solely via ambient cookie from untrusted origins are rejected with 403 Forbidden.
 *    - Authorization Bearer and trusted origins succeed.
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const {
  securityHeaders,
  hasNoSqlOperator,
  sanitizeNoSql,
  createRateLimiter,
  isValidImageUrl,
  sanitizeLogUrl,
  isAllowedOrigin
} = require('../middleware/security');

const { authenticate } = require('../middleware/auth');

const API_BASE = 'http://localhost:3000';

async function runTests() {
  console.log('--- STARTING PHASE 18 TARGETED SECURITY REVIEW SUITE ---');
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

  // Helper for HTTP requests
  function makeRequest(path, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, API_BASE);
      const payloadString = postData ? (typeof postData === 'string' ? postData : JSON.stringify(postData)) : null;
      const headers = { ...(options.headers || {}) };

      if (payloadString && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (payloadString && !headers['Content-Length']) {
        headers['Content-Length'] = Buffer.byteLength(payloadString);
      }

      const reqOptions = {
        method: options.method || 'GET',
        headers,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search
      };

      const req = http.request(reqOptions, (res) => {
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
      });

      req.on('error', reject);
      if (payloadString) {
        req.write(payloadString);
      }
      req.end();
    });
  }

  // Helper to create test user via API
  async function createApiUser(role = 'buyer') {
    const timestamp = Date.now();
    const userPayload = {
      username: `sec_${role}_${timestamp}`,
      email: `sec_${role}_${timestamp}@test.com`,
      password: 'SecPassword123!',
      role
    };

    const res = await makeRequest('/api/auth/register', { method: 'POST' }, userPayload);
    if (res.status === 201) {
      return { token: res.body.token, user: res.body.user, cookie: res.headers['set-cookie'] };
    }
    const loginRes = await makeRequest('/api/auth/login', { method: 'POST' }, {
      email: userPayload.email,
      password: userPayload.password
    });
    return { token: loginRes.body.token, user: loginRes.body.user, cookie: loginRes.headers['set-cookie'] };
  }

  // =========================================================================
  // CONTROL 1: sanitizeNoSql & hasNoSqlOperator
  // =========================================================================

  test('1.1 hasNoSqlOperator allows valid product, address, search and checkout data without modification', () => {
    const validProduct = {
      title: 'Smartphone v1.2 (Special Ed.)',
      description: 'Features 6.5 in. display & 50.5 MP camera.',
      price: 299.99,
      category: 'Electronics',
      stock: 15,
      variants: [
        { name: '128GB / 6.0 in', price: 299.99, sku: 'PH-128' },
        { name: '256GB / 6.5 in', price: 349.99, sku: 'PH-256' }
      ]
    };
    const validAddress = {
      street: '42 St. John\'s Rd., Apt. 5-B',
      city: 'St. Louis',
      state: 'MO',
      postalCode: '63101',
      country: 'India'
    };
    const validSearch = {
      search: 'iOS 17.2',
      category: 'Electronics',
      minPrice: '10.50',
      maxPrice: '99.99',
      page: '1',
      limit: '10'
    };
    const validCheckout = {
      items: [
        { productId: '650000000000000000000001', quantity: 2, variantId: '650000000000000000000002' }
      ],
      paymentMethod: 'card'
    };

    assert.strictEqual(hasNoSqlOperator(validProduct), false, 'Product data should be clean');
    assert.strictEqual(hasNoSqlOperator(validAddress), false, 'Address data should be clean');
    assert.strictEqual(hasNoSqlOperator(validSearch), false, 'Search query data should be clean');
    assert.strictEqual(hasNoSqlOperator(validCheckout), false, 'Checkout data should be clean');

    // Confirm objects are not modified
    assert.strictEqual(validProduct.price, 299.99);
    assert.strictEqual(validAddress.street, '42 St. John\'s Rd., Apt. 5-B');
    assert.strictEqual(validSearch.search, 'iOS 17.2');
  });

  test('1.2 hasNoSqlOperator detects prohibited $ and . operator keys in objects and nested arrays', () => {
    assert.strictEqual(hasNoSqlOperator({ $gt: '' }), true);
    assert.strictEqual(hasNoSqlOperator({ password: { $ne: null } }), true);
    assert.strictEqual(hasNoSqlOperator({ 'profile.role': 'admin' }), true);
    assert.strictEqual(hasNoSqlOperator({ tags: [{ $where: 'sleep(1000)' }] }), true);
    assert.strictEqual(hasNoSqlOperator({ query: { category: { $regex: '.*' } } }), true);
  });

  test('1.3 sanitizeNoSql middleware rejects malicious operators with HTTP 400 rather than silently corrupting input', () => {
    const maliciousReq = {
      body: { email: 'admin@eg.com', password: { $ne: null } },
      query: {},
      params: {}
    };

    let responseStatus = null;
    let responseBody = null;
    let nextCalled = false;

    const mockRes = {
      status(s) {
        responseStatus = s;
        return {
          json(b) { responseBody = b; }
        };
      }
    };

    sanitizeNoSql(maliciousReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'Middleware must not call next() for malicious operator');
    assert.strictEqual(responseStatus, 400, 'Must respond with HTTP 400 Bad Request');
    assert.ok(responseBody.message && responseBody.message.includes('Prohibited query operator'));
    // Crucially: input is NOT silently deleted/corrupted in-place
    assert.strictEqual(maliciousReq.body.password.$ne, null);
  });

  await testAsync('1.4 Live server rejects NoSQL operator injection in query string with HTTP 400', async () => {
    // In Express 4.x with qs, ?search[$gt]=0 parses as req.query.search = { '$gt': '0' }
    const res = await makeRequest('/api/products?search[$gt]=0');
    assert.strictEqual(res.status, 400, `Expected HTTP 400 for query injection, got ${res.status}`);
    assert.ok(res.body.message && res.body.message.includes('Prohibited query operator'));
  });

  // =========================================================================
  // CONTROL 2: isValidImageUrl & SVG Exclusion
  // =========================================================================

  test('2.1 isValidImageUrl strictly rejects SVG data URIs to eliminate XSS script execution vectors', () => {
    const rawSvgBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const svgDataUrl = `data:image/svg+xml;base64,${rawSvgBase64}`;

    assert.strictEqual(isValidImageUrl(svgDataUrl), false, 'SVG data URI must be rejected');
    assert.strictEqual(isValidImageUrl('data:image/svg+xml;utf8,<svg></svg>'), false);
    assert.strictEqual(isValidImageUrl('data:image/svg;base64,PHN2Zz48L3N2Zz4='), false);
  });

  test('2.2 isValidImageUrl retains supported raster formats and safe https image URLs', () => {
    // PNG
    assert.strictEqual(isValidImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), true);
    // JPEG
    assert.strictEqual(isValidImageUrl('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), true);
    // WebP
    assert.strictEqual(isValidImageUrl('data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), true);
    // GIF
    assert.strictEqual(isValidImageUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), true);
    // HTTPS URL
    assert.strictEqual(isValidImageUrl('https://images.unsplash.com/photo-1542291026-7eec264c27ff'), true);
  });

  // =========================================================================
  // CONTROL 3: Cookie Settings & CSRF Defense-in-Depth
  // =========================================================================

  await testAsync('3.1 Registration and login set SameSite=Lax (not SameSite=None) on auth cookie', async () => {
    const buyer = await createApiUser('buyer');
    assert.ok(buyer.cookie, 'set-cookie header should be present');
    const cookieHeader = Array.isArray(buyer.cookie) ? buyer.cookie.join('; ') : buyer.cookie;

    assert.ok(/samesite=lax/i.test(cookieHeader), `Cookie must specify SameSite=Lax (got: ${cookieHeader})`);
    assert.ok(!/samesite=none/i.test(cookieHeader), `Cookie must NOT specify SameSite=None (got: ${cookieHeader})`);
    assert.ok(/httponly/i.test(cookieHeader), 'Cookie must be HttpOnly');
  });

  test('3.2 isAllowedOrigin correctly identifies approved origins and rejects foreign origins', () => {
    assert.strictEqual(isAllowedOrigin('http://localhost:5173'), true, 'localhost:5173 is allowed');
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5173'), true, '127.0.0.1:5173 is allowed');
    assert.strictEqual(isAllowedOrigin('https://egmarketplace.netlify.app'), true, 'Netlify app origin is allowed');

    // Foreign origins
    assert.strictEqual(isAllowedOrigin('http://attacker.com'), false, 'Attacker origin must be rejected');
    assert.strictEqual(isAllowedOrigin('https://evil-phishing.com'), false, 'Phishing origin must be rejected');
  });

  await testAsync('3.3 authenticate middleware blocks cookie-authenticated state-changing requests from untrusted origins', async () => {
    const buyer = await createApiUser('buyer');
    const rawCookie = Array.isArray(buyer.cookie) ? buyer.cookie[0] : buyer.cookie;
    const cookieTokenMatch = rawCookie.match(/token=([^;]+)/);
    const cookieToken = cookieTokenMatch ? cookieTokenMatch[1] : buyer.token;

    // Simulate cross-site state-changing request (POST) with cookie from untrusted origin
    const forgedReq = {
      method: 'POST',
      headers: {
        origin: 'http://attacker.com',
        cookie: `token=${cookieToken}`
      },
      cookies: {
        token: cookieToken
      }
    };

    let authStatus = null;
    let authBody = null;
    let nextCalled = false;

    const mockRes = {
      status(s) {
        authStatus = s;
        return {
          json(b) { authBody = b; }
        };
      }
    };

    await authenticate(forgedReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'State-changing request from untrusted origin must be rejected');
    assert.strictEqual(authStatus, 403, 'Must return 403 Forbidden for untrusted origin');
    assert.ok(authBody.message && authBody.message.includes('CSRF protection'));
  });

  await testAsync('3.4 authenticate middleware permits requests with Authorization Bearer header from allowed origin', async () => {
    const buyer = await createApiUser('buyer');

    const res = await makeRequest('/api/auth/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${buyer.token}`,
        'Origin': 'http://localhost:5173'
      }
    });

    assert.strictEqual(res.status, 200, `Expected 200 OK for Bearer token request, got ${res.status}`);
    assert.strictEqual(res.body.user.id, buyer.user.id);
  });

  console.log(`\nAll ${passed}/${total} Phase 18 Final Targeted Security tests passed successfully!`);
  process.exit(0);
}

runTests().catch(err => {
  console.error('\nTargeted test suite failed:', err);
  process.exit(1);
});
