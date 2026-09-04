const { spawnSync } = require('node:child_process');

const maxAttempts = 3;
const transientPattern = /503 Service Unavailable|EAI_AGAIN|ECONNRESET|ETIMEDOUT|audit endpoint returned an error|timed out/i;

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      npm_config_fetch_retries: '1',
      npm_config_fetch_retry_mintimeout: '1000',
      npm_config_fetch_retry_maxtimeout: '10000'
    }
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  process.stdout.write(output);

  if (result.status === 0) process.exit(0);

  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  if (!timedOut && !transientPattern.test(output)) {
    process.exit(typeof result.status === 'number' ? result.status : 1);
  }

  if (attempt < maxAttempts) {
    console.log(`npm audit service was temporarily unavailable. Retrying (${attempt + 1}/${maxAttempts})...`);
    wait(5000);
  }
}

console.error(`::error title=npm audit unavailable::The npm vulnerability service could not be reached after ${maxAttempts} attempts. No vulnerability result was returned, so the security gate remains closed. The scheduled daily workflow will try again.`);
process.exit(1);
