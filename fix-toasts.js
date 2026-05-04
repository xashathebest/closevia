const fs = require('fs');
const path = require('path');

const files = [
  'client/src/pages/ProductDetail.tsx',
  'client/src/pages/Home.tsx',
  'client/src/pages/UserProfile.tsx',
  'client/src/delivery_option/rider.tsx',
  'client/src/components/ViewTradeModal.tsx',
  'client/src/pages/Dashboard.tsx',
  'client/src/pages/AdminDashboard.tsx',
  'client/src/pages/AddProduct.tsx',
  'client/src/components/TradeModal.tsx',
  'client/src/components/TradeCompletionStatus.tsx',
  'client/src/components/TradeCompletionModal.tsx',
  'client/src/components/DeliveryTracking.tsx',
  'client/src/components/OfferDetailsModal.tsx',
  'client/src/components/BuyoutModal.tsx',
  'client/src/pages/Login.tsx',
  'client/src/pages/Settings.tsx',
  'client/src/components/ProductUploadStep1.tsx',
  'client/src/pages/SavedProducts.tsx',
  'client/src/delivery_option/riderqueue.tsx',
  'client/src/delivery_option/TaskStepper.tsx',
  'client/src/delivery_option/BatchPreview.tsx',
  'client/src/pages/Register.tsx',
  'client/src/components/ProductUploadStep2.tsx',
  'client/src/components/ProductUploadFlow.tsx',
  'client/src/components/ProductUploadStep3.tsx',
  'client/src/pages/VerifyEmail.tsx',
  'client/src/hooks/useTradeLoopNotifications.ts',
  'client/src/components/DeliveryRequestModal.tsx',
  'client/src/pages/Trades.tsx',
  'client/src/pages/premium.tsx',
  'client/src/pages/Notifications.tsx',
  'client/src/pages/EditProduct.tsx',
  'client/src/delivery_option/delivery.tsx',
  'client/src/delivery_option/RemittanceLedger.tsx',
  'client/src/delivery_option/BatchStatus.tsx',
  'client/src/components/TradeLoopsDisplay.tsx',
  'client/src/components/MultiWayTradeModal.tsx',
];

let totalFixed = 0;

files.forEach(function(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) return;
  let content = fs.readFileSync(fullPath, 'utf8');
  const fileBase = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[^a-z0-9]/g, '-');

  let counter = 0;
  let fileFixed = 0;
  const usedIds = {};

  const newContent = content.replace(/toast\(\{([\s\S]*?)\}\)/g, function(match, inner) {
    counter++;
    // If already has id, skip
    if (/^\s*id\s*:/m.test(inner)) return match;

    // Extract title for the id
    const titleMatch = inner.match(/title:\s*['"`]([^'"`]+)['"`]/);
    let idValue;
    if (titleMatch) {
      idValue = titleMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      idValue = fileBase + '-' + idValue;
    } else {
      idValue = fileBase + '-toast-' + counter;
    }

    // Ensure uniqueness within file
    if (usedIds[idValue]) {
      usedIds[idValue]++;
      idValue = idValue + '-' + usedIds[idValue];
    } else {
      usedIds[idValue] = 1;
    }

    fileFixed++;
    return match.replace('toast({', 'toast({\n        id: "' + idValue + '",');
  });

  if (fileFixed > 0) {
    fs.writeFileSync(fullPath, newContent, 'utf8');
    totalFixed += fileFixed;
    console.log(filePath + ': fixed ' + fileFixed + ' toasts');
  }
});

console.log('Total toasts fixed: ' + totalFixed);
