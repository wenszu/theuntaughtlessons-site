const { spawn } = require('node:child_process');

const maxAttempts = 3;
const timeoutMs = 30_000;
const transientPattern = /503 Service Unavailable|EAI_AGAIN|ECONNRESET|ETIMEDOUT|audit endpoint returned an error|timed out/i;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runAudit() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['audit', '--omit=dev', '--audit-level=high'], {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        npm_config_fetch_retries: '1',
        npm_config_fetch_retry_mintimeout: '1000',
        npm_config_fetch_retry_maxtimeout: '10000'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (_) {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: `${output}${error.message}\n`, timedOut });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status: typeof status === 'number' ? status : 1, output, timedOut });
    });
  });
}

(async () => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAudit();
    process.stdout.write(result.output);

    if (result.status === 0) process.exit(0);

    if (!result.timedOut && !transientPattern.test(result.output)) {
      process.exit(result.status);
    }

    if (attempt < maxAttempts) {
      console.log(`npm audit service was temporarily unavailable. Retrying (${attempt + 1}/${maxAttempts})...`);
      await wait(5000);
    }
  }

  console.error(`::error title=npm audit unavailable::The npm vulnerability service could not be reached after ${maxAttempts} attempts. No vulnerability result was returned, so the security gate remains closed. The scheduled daily workflow will try again.`);
  process.exit(1);
})();
