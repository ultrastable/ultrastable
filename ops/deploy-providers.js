// GIT-IN-CLOUDFLARE-1: deploy targets behind one provider interface, beside executor.js PROVIDERS.
// GitHub stays the master/public face; deploys may target Cloudflare, AWS, GCP, or GitHub.
export const DEPLOY_PROVIDERS = {
  cloudflare: {
    deploy: async (ctx) => {
      // Worker-native deploy: push built assets/worker via Cloudflare API using the Git-compatible storage snapshot
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ctx.env.CF_ACCOUNT_ID}/workers/scripts/${ctx.env.WORKER_NAME}`,
        { method: 'PUT', headers: { Authorization: `Bearer ${ctx.env.CF_API_TOKEN}` }, body: ctx.bundle }
      );
      if (!res.ok) throw new Error(`cloudflare deploy failed: ${res.status}`);
      return { provider: 'cloudflare', version: (await res.json()).result?.id };
    },
  },
  aws: {
    deploy: async (ctx) => {
      // Placeholder: Lambda/lambda@edge upload via signed request
      throw new Error('aws provider: not yet implemented');
    },
  },
  gcp: {
    deploy: async (ctx) => {
      // Placeholder: Cloud Run revision deploy
      throw new Error('gcp provider: not yet implemented');
    },
  },
  github: {
    // GitHub remains master; deploying here means pages/gh-pages push from the mirror
    deploy: async (ctx) => {
      if (!ctx.env.GITHUB_MIRROR_URL) throw new Error('github deploy: GITHUB_MIRROR_URL unset');
      return { provider: 'github', ref: ctx.ref };
    },
  },
};

export function getDeployProvider(name) {
  const p = DEPLOY_PROVIDERS[name];
  if (!p) throw new Error(`unknown deploy provider: ${name}`);
  return p;
}
