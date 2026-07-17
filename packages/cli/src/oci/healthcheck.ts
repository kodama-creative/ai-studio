async function _healthcheck(): Promise<number> {
  try {
    const response = await fetch("http://127.0.0.1:7331/v1/ready");
    return response.ok ? 0 : 1;
  } catch {
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await _healthcheck();
}
