// GIT-IN-CLOUDFLARE-1: one provider interface for deploy targets,
// beside executor.js PROVIDERS. GitHub remains master; loops depend only on this interface.

class DeployProvider {
  constructor(name) { this.name = name; }
  async deploy({ artifact, ref }) { throw new Error(`not implemented: ${this.name}`); }
}

class CloudflareProvider extends DeployProvider {
  constructor() { super('cloudflare'); }
  async deploy({ artifact, ref }) {
    // wrangler deploy from the Worker's working copy in Cloudflare Git storage
    const { run } = await import('./exec.mjs');
    return run(`npx wrangler deploy ${artifact} --branch ${ref}`);
  }
}

class AWSProvider extends DeployProvider {
  constructor() { super('aws'); }
  async deploy({ artifact, ref }) {
    const { run } = await import('./exec.mjs');
    return run(`aws s3 cp ${artifact} s3://$AWS_DEPLOY_BUCKET/${ref}/ && aws lambda update-function-code --function-name $AWS_FUNCTION --zip-file fileb://${artifact}`);
  }
}

class GCPProvider extends DeployProvider {
  constructor() { super('gcp'); }
  async deploy({ artifact, ref }) {
    const { run } = await import('./exec.mjs');
    return run(`gcloud functions deploy $GCP_FUNCTION --source ${artifact} --runtime nodejs20`);
  }
}

class GitHubProvider extends DeployProvider {
  constructor() { super('github'); }
  async deploy({ artifact, ref }) {
    // push to GitHub mirror (master/public face)
    const { run } = await import('./exec.mjs');
    return run(`git push ${process.env.MIRROR_URL} ${ref}`);
  }
}

export const DEPLOY_PROVIDERS = {
  cloudflare: new CloudflareProvider(),
  aws: new AWSProvider(),
  gcp: new GCPProvider(),
  github: new GitHubProvider(),
};

export function getDeployProvider(name) {
  const p = DEPLOY_PROVIDERS[name];
  if (!p) throw new Error(`unknown deploy provider: ${name}`);
  return p;
}
