export interface SportmonksConfig {
  token: string;
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SportmonksConfig {
  const token = env.SPORTMONKS_API_TOKEN;
  if (!token) {
    throw new Error('SPORTMONKS_API_TOKEN is not set; export it before using the Sportmonks client');
  }
  return { token, dataDir: env.FC_DATA_DIR || './data' };
}
