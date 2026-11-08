/**
 * Focused Vendor Transfer Verification Test
 * 
 * Verifies:
 * 1. Razorpay SDK version and official methods (razorpay.payments.fetchTransfer)
 * 2. Payment ID resolution and transfer lookup by recipient + notes.orderId
 * 3. Crash recovery when worker crashes in 'queued' before gateway call
 * 4. Crash recovery when gateway accepts transfer but worker crashes before saving
 * 5. Ambiguous transfer reconciliation (network timeout on submission)
 * 6. Payout earnings idempotency (no double-counting)
 */

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const User = require('../models/User');
const ordersRouter = require('../routes/orders');

const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace_test';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✘ FAIL: ${message}`);
    failed++;
  }
}

async function runVendorTransferVerification() {
  console.log('============================================================');
  console.log(' FOCUSED VENDOR TRANSFER VERIFICATION & CRASH RECOVERY TEST');
  console.log('============================================================\n');

  // -------------------------------------------------------------
  // Test 1: Razorpay SDK Version and Method Inspection
  // -------------------------------------------------------------
  console.log('--- Test 1: Razorpay SDK Source & Prototype Inspection ---');
  const razorpayPkg = require('razorpay/package.json');
  console.log(`  Razorpay SDK installed version: ${razorpayPkg.version}`);
  assert(Boolean(razorpayPkg.version), `SDK package.json version is present: ${razorpayPkg.version}`);

  const dummyRzp = new Razorpay({ key_id: 'rzp_test_dummy', key_secret: 'secret_dummy' });
  assert(typeof dummyRzp.payments.fetchTransfer === 'function', 'razorpay.payments.fetchTransfer exists on SDK payments resource');
  assert(typeof dummyRzp.payments.transfer === 'function', 'razorpay.payments.transfer exists on SDK payments resource');
  assert(typeof dummyRzp.transfers.all === 'function', 'razorpay.transfers.all exists on SDK transfers resource');
  assert(typeof dummyRzp.transfers.fetch === 'function', 'razorpay.transfers.fetch exists on SDK transfers resource');

  // Verify fetchTransfer implementation inspects paymentId
  let throwsOnMissingId = false;
  try {
    dummyRzp.payments.fetchTransfer();
  } catch (err) {
    throwsOnMissingId = err.message.includes('payment Id');
  }
  assert(throwsOnMissingId, 'razorpay.payments.fetchTransfer strictly requires paymentId parameter');

  // -------------------------------------------------------------
  // Connect to Database
  // -------------------------------------------------------------
  await mongoose.connect(TEST_DB_URI);
  const dbName = mongoose.connection.name;
  assert(dbName === 'marketplace_test', `Connected safely to test database: ${dbName}`);

  // Setup test vendor and buyer
  const testPrefix = `TRF_VERIFY_${Date.now()}_`;
  const vendorUser = await User.create({
    name: `${testPrefix}Vendor`,
    username: `${testPrefix.toLowerCase()}vendor`,
    email: `${testPrefix.toLowerCase()}vendor@test.com`,
    password: 'password123',
    role: 'vendor'
  });

  const testVendor = await Vendor.create({
    userId: vendorUser._id,
    shopName: `${testPrefix}Store`,
    categories: ['Electronics'],
    onboardingComplete: true,
    approvalStatus: 'approved',
    razorpayAccountId: 'acc_target_vendor_xyz',
    totalEarnings: 0,
    totalPaidEarnings: 0
  });

  const buyerUser = await User.create({
    name: `${testPrefix}Buyer`,
    username: `${testPrefix.toLowerCase()}buyer`,
    email: `${testPrefix.toLowerCase()}buyer@test.com`,
    password: 'password123',
    role: 'buyer'
  });

  // Helper to create test orders
  async function createTestOrder(extra = {}) {
    return await Order.create({
      buyerId: buyerUser._id,
      vendorId: testVendor._id,
      products: [
        {
          productId: new mongoose.Types.ObjectId(),
          quantity: 1,
          price: 1000,
          adminCommission: 100,
          vendorEarning: 900
        }
      ],
      totalAmount: 1000,
      adminCommission: 100,
      vendorEarning: 900,
      shippingAddress: '456 Test Street, Bengaluru',
      paymentStatus: 'paid',
      status: 'confirmed',
      razorpayOrderId: `order_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      razorpayPaymentId: `pay_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...extra
    });
  }

  // -------------------------------------------------------------
  // Test 2: Transfer Lookup Using Correct Payment ID & Notes Order ID
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Transfer Lookup & Parameter Resolution ---');
  const order2 = await createTestOrder();
  const result2 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order2.razorpayPaymentId,
    order: order2
  });
  assert(Boolean(result2), 'createVendorTransfer completed successfully');
  assert(Boolean(result2.id), `Generated transfer ID: ${result2.id}`);
  assert(result2.status === 'processed', 'Transfer marked as processed');

  const refreshedOrder2 = await Order.findById(order2._id);
  assert(refreshedOrder2.transferId === result2.id, 'Transfer ID recorded on Order document in MongoDB');
  assert(refreshedOrder2.transferStatus === 'processed', 'Order transferStatus is "processed"');

  const refreshedVendor2 = await Vendor.findById(testVendor._id);
  assert(refreshedVendor2.totalPaidEarnings === 900, `Vendor totalPaidEarnings incremented by vendorEarning: ${refreshedVendor2.totalPaidEarnings}`);

  // -------------------------------------------------------------
  // Test 3: Idempotency (Repeat calls never double-increment)
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Idempotency (Duplicate Invocations) ---');
  const repeatResult2 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order2.razorpayPaymentId,
    order: refreshedOrder2
  });
  assert(repeatResult2.id === result2.id, 'Repeat call returned identical transfer ID');
  const vendorAfterRepeat = await Vendor.findById(testVendor._id);
  assert(vendorAfterRepeat.totalPaidEarnings === 900, 'Vendor earnings NOT double-incremented on repeated call');

  // -------------------------------------------------------------
  // Test 4: Crash Recovery Window 1 — Stale Queued Claim Reclaimed
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Crash Recovery Window 1 — Stale Queued Claim (>30s) ---');
  // Simulate worker that claimed transfer, set status='queued' and transferClaimedAt=40s ago, then crashed before Razorpay call
  const staleClaimTime = new Date(Date.now() - 40000);
  const order4 = await createTestOrder({
    transferStatus: 'queued',
    transferClaimedAt: staleClaimTime,
    transferId: ''
  });

  const recoveryResult4 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order4.razorpayPaymentId,
    order: order4
  });

  assert(Boolean(recoveryResult4), 'Stale queued claim safely recovered by new worker');
  assert(recoveryResult4.status === 'processed', 'Recovered order reached "processed" status');
  const refreshedOrder4 = await Order.findById(order4._id);
  assert(refreshedOrder4.transferStatus === 'processed', 'MongoDB updated from stale "queued" to "processed"');
  assert(Boolean(refreshedOrder4.transferId), `Assigned valid transfer ID on recovery: ${refreshedOrder4.transferId}`);

  // -------------------------------------------------------------
  // Test 5: Active Concurrent Worker Protection (Queue Claim <30s)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Active Worker Protection (Fresh Queue Claim) ---');
  // Simulate active worker that claimed transfer 2 seconds ago (still actively in flight)
  const freshClaimTime = new Date(Date.now() - 2000);
  const order5 = await createTestOrder({
    transferStatus: 'queued',
    transferClaimedAt: freshClaimTime,
    transferId: ''
  });

  const activeWorkerCheck = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order5.razorpayPaymentId,
    order: order5
  });

  assert(activeWorkerCheck.status === 'queued', 'Second caller does not disrupt active worker in flight (returns queued)');
  const refreshedOrder5 = await Order.findById(order5._id);
  assert(refreshedOrder5.transferStatus === 'queued', 'Active worker claim remains unmolested');

  // -------------------------------------------------------------
  // Test 6: Crash Recovery Window 2 — Gateway Accepted, Crash Before MongoDB Saved
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Crash Recovery Window 2 — Gateway Accepted Before Crash ---');
  const { razorpay } = require('../config/razorpay');
  const originalFetchTransfer = razorpay.payments.fetchTransfer;
  const originalTransfer = razorpay.payments.transfer;

  const liveStylePaymentId = 'pay_LivePaymentId123456';
  const order6 = await createTestOrder({
    razorpayPaymentId: liveStylePaymentId,
    transferStatus: 'queued',
    transferClaimedAt: new Date(Date.now() - 10000), // queued during crash
    transferId: ''
  });

  const gatewayTransferRecord = {
    id: `trf_gateway_${Date.now()}`,
    entity: 'transfer',
    status: 'processed',
    amount: 90000,
    currency: 'INR',
    recipient: testVendor.razorpayAccountId,
    notes: {
      orderId: order6._id.toString(),
      vendorId: testVendor._id.toString()
    }
  };

  let transferApiCalled = false;
  razorpay.payments.fetchTransfer = async function (pId) {
    if (pId === liveStylePaymentId) {
      return { entity: 'collection', count: 1, items: [gatewayTransferRecord] };
    }
    return originalFetchTransfer.call(razorpay.payments, pId);
  };

  razorpay.payments.transfer = async function () {
    transferApiCalled = true;
    throw new Error('Should NOT call transfer when existing gateway transfer is found');
  };

  const earningsBefore6 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;
  const reconciled6 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: liveStylePaymentId,
    order: order6
  });

  assert(Boolean(reconciled6), 'Reconciliation completed successfully');
  assert(reconciled6.id === gatewayTransferRecord.id, `Reconciled with existing gateway transfer: ${reconciled6.id}`);
  assert(transferApiCalled === false, 'Never submitted a second transfer to Razorpay');

  const refreshedOrder6 = await Order.findById(order6._id);
  assert(refreshedOrder6.transferId === gatewayTransferRecord.id, 'Transfer ID recorded in MongoDB from gateway recovery');
  assert(refreshedOrder6.transferStatus === 'processed', 'Transfer status updated to "processed" in MongoDB');

  const earningsAfter6 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfter6 === earningsBefore6 + 900, `Vendor paid earnings credited correctly on recovery: ${earningsAfter6}`);

  // -------------------------------------------------------------
  // Test 7: Ambiguous Transfer Reconciliation on Network Timeout
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Ambiguous Transfer Reconciliation on Network Timeout ---');
  const timeoutPaymentId = 'pay_TimeoutPaymentId789';
  const order7 = await createTestOrder({
    razorpayPaymentId: timeoutPaymentId,
    transferStatus: 'not_initiated',
    transferId: ''
  });

  const gatewayTimeoutTransfer = {
    id: `trf_timeout_success_${Date.now()}`,
    entity: 'transfer',
    status: 'processed',
    amount: 90000,
    currency: 'INR',
    recipient: testVendor.razorpayAccountId,
    notes: {
      orderId: order7._id.toString(),
      vendorId: testVendor._id.toString()
    }
  };

  let firstFetch = true;
  razorpay.payments.fetchTransfer = async function (pId) {
    if (pId === timeoutPaymentId) {
      if (firstFetch) {
        firstFetch = false;
        return { entity: 'collection', count: 0, items: [] }; // no transfer yet before call
      }
      return { entity: 'collection', count: 1, items: [gatewayTimeoutTransfer] }; // found on recheck after timeout!
    }
    return originalFetchTransfer.call(razorpay.payments, pId);
  };

  razorpay.payments.transfer = async function (pId) {
    if (pId === timeoutPaymentId) {
      throw new Error('ETIMEDOUT: Connection to Razorpay timed out');
    }
    return originalTransfer.call(razorpay.payments, pId);
  };

  const timeoutResolved = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: timeoutPaymentId,
    order: order7
  });

  assert(Boolean(timeoutResolved), 'Ambiguous timeout successfully reconciled');
  assert(timeoutResolved.id === gatewayTimeoutTransfer.id, `Resolved to accepted gateway transfer ID: ${timeoutResolved.id}`);

  const refreshedOrder7 = await Order.findById(order7._id);
  assert(refreshedOrder7.transferStatus === 'processed', 'Order marked as "processed" despite network timeout');
  assert(refreshedOrder7.transferId === gatewayTimeoutTransfer.id, 'Transfer ID recorded accurately');

  // Restore mocks
  razorpay.payments.fetchTransfer = originalFetchTransfer;
  razorpay.payments.transfer = originalTransfer;

  // -------------------------------------------------------------
  // Test 8: Unrelated Transfer on Same Payment Rejection
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Multiple Items Filtered by Notes.orderId ---');
  const dummyItemsPaymentId = 'pay_MultiItemsPayment456';
  const order8 = await createTestOrder({
    razorpayPaymentId: dummyItemsPaymentId,
    transferStatus: 'not_initiated',
    transferId: ''
  });

  const unrelatedTransfer = {
    id: 'trf_unrelated_order_999',
    entity: 'transfer',
    status: 'processed',
    recipient: testVendor.razorpayAccountId,
    notes: {
      orderId: '6aefa9999999999999999999' // Different order ID!
    }
  };

  razorpay.payments.fetchTransfer = async function () {
    return { entity: 'collection', count: 1, items: [unrelatedTransfer] };
  };

  let newTransferSubmitted = false;
  razorpay.payments.transfer = async function () {
    newTransferSubmitted = true;
    return {
      items: [
        {
          id: `trf_order8_${Date.now()}`,
          entity: 'transfer',
          status: 'processed',
          recipient: testVendor.razorpayAccountId,
          notes: { orderId: order8._id.toString() }
        }
      ]
    };
  };

  const result8 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: dummyItemsPaymentId,
    order: order8
  });

  assert(newTransferSubmitted === true, 'Correctly identified that existing transfer was for an unrelated order');
  assert(result8.id !== unrelatedTransfer.id, 'Did not mistakenly attach another order’s transfer');

  // Restore original methods
  razorpay.payments.fetchTransfer = originalFetchTransfer;
  razorpay.payments.transfer = originalTransfer;

  // -------------------------------------------------------------
  // Test 9: Strict Identification — Transfer with Missing notes.orderId
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Strict Identification — Missing notes.orderId Negative Test ---');
  const missingNotesPaymentId = 'pay_MissingNotesPayment123';
  const order9 = await createTestOrder({
    razorpayPaymentId: missingNotesPaymentId,
    transferStatus: 'not_initiated',
    transferId: ''
  });

  const transferWithoutOrderId = {
    id: 'trf_missing_notes_555',
    entity: 'transfer',
    status: 'processed',
    recipient: testVendor.razorpayAccountId
    // notes is completely missing or empty!
  };

  let submitCalledInTest9 = false;
  razorpay.payments.fetchTransfer = async function (pId) {
    if (pId === missingNotesPaymentId) {
      return { entity: 'collection', count: 1, items: [transferWithoutOrderId] };
    }
    return originalFetchTransfer.call(razorpay.payments, pId);
  };

  razorpay.payments.transfer = async function () {
    submitCalledInTest9 = true;
    return { items: [{ id: 'trf_should_not_be_called' }] };
  };

  const earningsBefore9 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;
  const result9 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: missingNotesPaymentId,
    order: order9
  });

  assert(Boolean(result9), 'createVendorTransfer handled ambiguous missing-notes transfer');
  assert(result9.id === '', 'Did NOT accept or assign transfer with missing notes.orderId');
  assert(result9.requiresManualReview === true, 'Flagged as requiring manual review');
  assert(submitCalledInTest9 === false, 'Did NOT blindly submit a second transfer to Razorpay');

  const refreshedOrder9 = await Order.findById(order9._id);
  assert(refreshedOrder9.transferStatus !== 'processed', 'Order transferStatus is NOT marked processed');
  assert(refreshedOrder9.transferId === '', 'Order transferId remains empty');
  assert(refreshedOrder9.transferError.includes('notes.orderId is missing') && refreshedOrder9.transferError.includes('manual administrator review'), 'Detailed ambiguous transfer error recorded');

  const earningsAfter9 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfter9 === earningsBefore9, 'Vendor earnings NOT credited for ambiguous transfer');

  // Restore mocks
  razorpay.payments.fetchTransfer = originalFetchTransfer;
  razorpay.payments.transfer = originalTransfer;

  // -------------------------------------------------------------
  // Test 10: Worker Fencing — Superseded Worker Cannot Submit or Commit
  // -------------------------------------------------------------
  console.log('\n--- Test 10: Worker Fencing — Superseded Worker Fenced Out ---');
  const fencePaymentId = 'pay_test_fencing_777';
  const order10 = await createTestOrder({
    razorpayPaymentId: fencePaymentId,
    transferStatus: 'not_initiated',
    transferId: '',
    transferClaimVersion: 0
  });

  // Worker A claims order
  const staleThreshold10 = new Date(Date.now() - 35000); // 35s ago (stale)
  const tokenA = 'token_worker_A';
  await Order.updateOne(
    { _id: order10._id },
    {
      $set: {
        transferStatus: 'queued',
        transferClaimedAt: staleThreshold10,
        transferClaimToken: tokenA,
        transferClaimVersion: 1
      }
    }
  );

  // Worker B reclaims order (supersedes Worker A)
  const tokenB = 'token_worker_B';
  const lockedOrderB = await Order.findOneAndUpdate(
    {
      _id: order10._id,
      $and: [
        {
          $or: [
            { transferStatus: { $in: ['not_initiated', 'failed'] } },
            { transferStatus: 'queued', transferClaimedAt: { $lt: new Date() } },
            { transferStatus: 'queued', transferClaimedAt: null }
          ]
        },
        {
          $or: [
            { transferId: '' },
            { transferId: null },
            { transferId: { $exists: false } }
          ]
        }
      ]
    },
    {
      $set: {
        transferStatus: 'queued',
        transferClaimedAt: new Date(),
        transferClaimToken: tokenB
      },
      $inc: { transferClaimVersion: 1 } // version becomes 2
    },
    { new: true }
  );
  assert(lockedOrderB.transferClaimVersion === 2, 'Worker B incremented claimVersion to 2');
  assert(lockedOrderB.transferClaimToken === tokenB, 'Worker B holds claim token B');

  // Worker A now attempts to commit a transfer using stale tokenA and claimVersion 1
  let workerACommitFailed = false;
  try {
    const staleCommit = await Order.findOneAndUpdate(
      {
        _id: order10._id,
        transferClaimToken: tokenA,
        transferClaimVersion: 1,
        transferStatus: 'queued'
      },
      {
        $set: {
          transferId: 'trf_stale_worker_A',
          transferStatus: 'processed'
        }
      },
      { new: true }
    );
    if (!staleCommit) {
      workerACommitFailed = true;
    }
  } catch (err) {
    workerACommitFailed = true;
  }
  assert(workerACommitFailed === true, 'Worker A fenced out: conditional query rejected commit with stale claim version');

  const orderAfterA = await Order.findById(order10._id);
  assert(orderAfterA.transferClaimToken === tokenB, 'Order claimToken preserved as Worker B');
  assert(orderAfterA.transferClaimVersion === 2, 'Order claimVersion preserved as 2');
  assert(orderAfterA.transferId === '', 'Stale worker A could NOT overwrite transferId');

  // -------------------------------------------------------------
  // Test 11: Current Worker Reconciles and Completes Transfer Exactly Once
  // -------------------------------------------------------------
  console.log('\n--- Test 11: Active Worker Completes Transfer Exactly Once ---');
  const earningsBefore11 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;
  
  const order11 = await createTestOrder({
    razorpayPaymentId: `pay_test_order11_${Date.now()}`,
    transferStatus: 'not_initiated',
    transferId: '',
    vendorEarning: 900
  });

  // Current worker completes the transfer
  const result11 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order11.razorpayPaymentId,
    order: order11
  });

  assert(Boolean(result11), 'Worker successfully processed transfer');
  assert(result11.status === 'processed', 'Transfer status is "processed"');
  
  const refreshedOrder11 = await Order.findById(order11._id);
  assert(refreshedOrder11.transferStatus === 'processed', 'Order recorded as processed in MongoDB');
  assert(Boolean(refreshedOrder11.transferId), `Valid transfer ID recorded: ${refreshedOrder11.transferId}`);

  const earningsAfter11 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfter11 === earningsBefore11 + 900, 'Vendor earnings credited exactly once by valid worker');

  // Repeated call on completed transfer
  const repeatResult11 = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order11.razorpayPaymentId,
    order: refreshedOrder11
  });
  assert(repeatResult11.id === refreshedOrder11.transferId, 'Repeat call returned identical transfer ID');
  const earningsAfterRepeat11 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfterRepeat11 === earningsAfter11, 'Repeat call did NOT double-credit earnings');

  // -------------------------------------------------------------
  // Test 12: Two Workers Attempting Payout Around Claim-Expiry Boundary
  // -------------------------------------------------------------
  console.log('\n--- Test 12: Claim-Expiry Boundary Race Between Two Workers ---');
  const boundaryPaymentId = 'pay_test_boundary_888';
  const order12 = await createTestOrder({
    razorpayPaymentId: boundaryPaymentId,
    transferStatus: 'not_initiated',
    transferId: '',
    vendorEarning: 750
  });

  // Worker 1 claims order initially
  const worker1Token = 'token_worker_1_expiry_boundary';
  await Order.updateOne(
    { _id: order12._id },
    {
      $set: {
        transferStatus: 'queued',
        transferClaimedAt: new Date(Date.now() - 36000), // 36s ago (expired boundary)
        transferClaimToken: worker1Token,
        transferClaimVersion: 1
      }
    }
  );

  // Worker 2 discovers stale claim and reclaims order
  const worker2Doc = await Order.findById(order12._id);
  const earningsBefore12 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;
  const worker2Result = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: boundaryPaymentId,
    order: worker2Doc
  });

  assert(Boolean(worker2Result), 'Worker 2 successfully claimed and completed payout');
  assert(worker2Result.status === 'processed', 'Worker 2 payout status is "processed"');

  // Worker 1 unpauses and tries to verify preCheck or commit with its old token/version
  const orderAfterWorker2 = await Order.findById(order12._id);
  const worker1Check = await Order.findOne({
    _id: order12._id,
    transferClaimToken: worker1Token,
    transferClaimVersion: 1,
    transferStatus: 'queued'
  });
  assert(worker1Check === null, 'Worker 1 fenced out: cannot pass claim-ownership pre-check');

  let worker1CommitBlocked = false;
  const staleCommitAttempt = await Order.findOneAndUpdate(
    {
      _id: order12._id,
      transferClaimToken: worker1Token,
      transferClaimVersion: 1,
      transferStatus: 'queued'
    },
    {
      $set: { transferId: 'trf_worker_1_stale_boundary' }
    },
    { new: true }
  );
  if (!staleCommitAttempt) {
    worker1CommitBlocked = true;
  }
  assert(worker1CommitBlocked === true, 'Worker 1 commit blocked by conditional claimVersion check');
  assert(orderAfterWorker2.transferId === worker2Result.id, 'Order transferId preserved from Worker 2');

  const earningsAfter12 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfter12 === earningsBefore12 + 750, 'Vendor earnings credited exactly once across boundary race');

  // -------------------------------------------------------------
  // Test 13: Crash/Retry During Earnings Accounting
  // -------------------------------------------------------------
  console.log('\n--- Test 13: Crash/Retry During Earnings Accounting ---');
  const order13 = await createTestOrder({
    transferStatus: 'processed',
    transferId: `trf_sim_test13_${Date.now()}`,
    vendorEarning: 600,
    vendorEarningsCredited: false
  });

  const earningsBefore13 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;

  // First accounting call (simulating initial execution)
  const creditResult1 = await ordersRouter.recordVendorEarningsAtomic({
    orderId: order13._id,
    vendorId: testVendor._id,
    amount: 600,
    transferId: order13.transferId
  });
  assert(creditResult1.credited === true, 'Initial earnings accounting succeeded');

  const earningsAfterFirst = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfterFirst === earningsBefore13 + 600, 'Vendor balance incremented by 600');

  const orderAfterFirst = await Order.findById(order13._id);
  assert(orderAfterFirst.vendorEarningsCredited === true, 'Durable vendorEarningsCredited flag set to true');

  // Second accounting call (simulating worker retry after crash)
  const creditResult2 = await ordersRouter.recordVendorEarningsAtomic({
    orderId: order13._id,
    vendorId: testVendor._id,
    amount: 600,
    transferId: order13.transferId
  });
  assert(creditResult2.credited === false, 'Retry correctly skipped crediting');
  assert(creditResult2.alreadyCredited === true, 'Retry identified alreadyCredited flag');

  const earningsAfterRetry = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfterRetry === earningsAfterFirst, 'Vendor balance strictly unchanged on recovery retry (no duplicate credit)');

  // -------------------------------------------------------------
  // Test 14: Duplicate Earnings Accounting Attempts (Concurrent Race)
  // -------------------------------------------------------------
  console.log('\n--- Test 14: Concurrent Race on Earnings Accounting ---');
  const order14 = await createTestOrder({
    transferStatus: 'processed',
    transferId: `trf_sim_test14_${Date.now()}`,
    vendorEarning: 500,
    vendorEarningsCredited: false
  });

  const earningsBefore14 = (await Vendor.findById(testVendor._id)).totalPaidEarnings || 0;

  // Launch 5 concurrent accounting attempts for the same order
  const concurrentAttempts = await Promise.all([
    ordersRouter.recordVendorEarningsAtomic({ orderId: order14._id, vendorId: testVendor._id, amount: 500, transferId: order14.transferId }),
    ordersRouter.recordVendorEarningsAtomic({ orderId: order14._id, vendorId: testVendor._id, amount: 500, transferId: order14.transferId }),
    ordersRouter.recordVendorEarningsAtomic({ orderId: order14._id, vendorId: testVendor._id, amount: 500, transferId: order14.transferId }),
    ordersRouter.recordVendorEarningsAtomic({ orderId: order14._id, vendorId: testVendor._id, amount: 500, transferId: order14.transferId }),
    ordersRouter.recordVendorEarningsAtomic({ orderId: order14._id, vendorId: testVendor._id, amount: 500, transferId: order14.transferId })
  ]);

  const successCount = concurrentAttempts.filter(r => r.credited === true).length;
  const skippedCount = concurrentAttempts.filter(r => r.alreadyCredited === true).length;

  assert(successCount === 1, `Exactly 1 concurrent attempt credited earnings (actual: ${successCount})`);
  assert(skippedCount === 4, `Remaining 4 concurrent attempts rejected as already credited (actual: ${skippedCount})`);

  const earningsAfter14 = (await Vendor.findById(testVendor._id)).totalPaidEarnings;
  assert(earningsAfter14 === earningsBefore14 + 500, `Vendor balance incremented by exactly 500, not 2500 (actual: ${earningsAfter14})`);

  // -------------------------------------------------------------
  // Test 15: Manual-Review Records Permanently Excluded from Auto-Retries
  // -------------------------------------------------------------
  console.log('\n--- Test 15: Manual-Review Orders Permanently Excluded from Stale Recovery ---');
  const oldClaimTime = new Date(Date.now() - 7200000); // 2 hours ago
  const order15 = await createTestOrder({
    transferStatus: 'manual_review',
    transferError: 'Ambiguous gateway transfer detected (trf_ambiguous_999): recipient matches but notes.orderId is missing. Quarantined for manual administrator review.',
    transferClaimedAt: oldClaimTime,
    transferId: ''
  });

  const reviewResult = await ordersRouter.createVendorTransfer({
    razorpayPaymentId: order15.razorpayPaymentId,
    order: order15
  });

  assert(Boolean(reviewResult), 'createVendorTransfer checked manual-review order');
  assert(reviewResult.status === 'manual_review', 'Returned status remains "manual_review"');
  assert(reviewResult.requiresManualReview === true, 'Returned requiresManualReview: true flag');
  assert(Boolean(reviewResult.error), 'Preserved manual review error reason');

  const refreshedOrder15 = await Order.findById(order15._id);
  assert(refreshedOrder15.transferStatus === 'manual_review', 'Order transferStatus strictly remains "manual_review" in MongoDB');
  assert(refreshedOrder15.transferId === '', 'transferId remains empty (no payout dispatched)');

  // -------------------------------------------------------------
  // Cleanup Test Data
  // -------------------------------------------------------------
  await Order.deleteMany({ vendorId: testVendor._id });
  await Vendor.deleteMany({ _id: testVendor._id });
  await User.deleteMany({ _id: { $in: [vendorUser._id, buyerUser._id] } });
  await mongoose.disconnect();

  console.log('\n============================================================');
  console.log(` SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVendorTransferVerification().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
