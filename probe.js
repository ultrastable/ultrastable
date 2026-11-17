import { verifyLive } from './verifyLive.js';

const probe = async () => {
  try {
    await verifyLive();
    console.log('Probe successful');
  } catch (error) {
    console.error('Probe failed:', error);
  }
};

export default probe;
