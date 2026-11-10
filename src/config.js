import { readFile } from 'node:fs/promises';

const REQUIRED_KEYS = ['GLPI_URL', 'GLPI_USER_TOKEN'];

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function parseConfig(text) {
  const values = new Map();

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      values.set(key, value);
    }
  }

  for (const key of REQUIRED_KEYS) {
    if (!values.get(key)) {
      throw new ConfigurationError(`O arquivo de configuração não contém ${key}.`);
    }
  }

  let url;
  try {
    url = new URL(values.get('GLPI_URL'));
  } catch {
    throw new ConfigurationError('GLPI_URL precisa ser uma URL HTTPS válida.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ConfigurationError('GLPI_URL precisa ser uma URL HTTPS válida, sem usuário, senha ou parâmetros.');
  }

  const writesValue = values.get('GLPI_ENABLE_WRITES')?.toLowerCase();
  if (writesValue && !['true', 'false'].includes(writesValue)) {
    throw new ConfigurationError('GLPI_ENABLE_WRITES aceita somente true ou false.');
  }

  return Object.freeze({
    baseUrl: url.toString().replace(/\/$/u, ''),
    userToken: values.get('GLPI_USER_TOKEN'),
    appToken: values.get('GLPI_APP_TOKEN') || undefined,
    writesEnabled: writesValue === 'true',
  });
}

export async function loadConfig(configPath) {
  if (!configPath?.trim()) {
    throw new ConfigurationError('Configure o caminho do arquivo usando GLPI_CONFIG_PATH.');
  }

  let text;
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    throw new ConfigurationError('Não foi possível ler o arquivo de configuração indicado.');
  }

  return parseConfig(text);
}
