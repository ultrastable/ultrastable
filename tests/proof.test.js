import { handler } from '../brand/public-profile/profile/proof.js';

async function testProofHandler() {
  const response = await handler();
  if (response.status !== 200) {
    throw new Error(`Expected status 200 but got ${response.status}`);
  }
  const data = await response.json();
  if (!data.message || !Array.isArray(data.data)) {
    throw new Error('Response does not match expected format');
  }
  console.log('Test passed: ultrastable.io/proof returns a valid product-side feed');
}

testProofHandler().catch(console.error);