// ... existing code ...
if (!token) return { status: 'no-token', checked: [], errors: [] };
const neededPermission = 'statuses';
const gateCard = {
  name: 'GATE-APP-PERMISSION',
  description: `GitHub App token missing ${neededPermission} permission`,
  consentLink: '/connect/github',
  defaultInEffect: true,
};
// ... existing code ...
function checkRepoAccess(repo) {
  // ... existing code ...
  if (!token || !token.permissions.includes(neededPermission)) {
    return { error: `Missing ${neededPermission} permission` };
  }
  // ... existing code ...
}
