import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';

test('lê pares CHAVE=valor preservando valores com sinais de igual', () => {
  const config = parseConfig([
    '# comentário',
    'GLPI_URL=https://glpi.exemplo.com/instancia/',
    'GLPI_USER_TOKEN=token=ficticio',
    'GLPI_APP_TOKEN=app-ficticio',
    'GLPI_ENABLE_WRITES=true',
  ].join('\n'));

  assert.equal(config.baseUrl, 'https://glpi.exemplo.com/instancia');
  assert.equal(config.userToken, 'token=ficticio');
  assert.equal(config.appToken, 'app-ficticio');
  assert.equal(config.writesEnabled, true);
});

test('mantém gravações desativadas por padrão e rejeita valor de configuração inválido', () => {
  const config = parseConfig('GLPI_URL=https://glpi.exemplo.com\nGLPI_USER_TOKEN=falso');
  assert.equal(config.writesEnabled, false);
  assert.throws(
    () => parseConfig('GLPI_URL=https://glpi.exemplo.com\nGLPI_USER_TOKEN=falso\nGLPI_ENABLE_WRITES=sim'),
    /somente true ou false/u,
  );
});

test('recusa campos obrigatórios ausentes e URLs que não sejam HTTPS', () => {
  assert.throws(() => parseConfig('GLPI_URL=https://glpi.exemplo.com'), /GLPI_USER_TOKEN/u);
  assert.throws(
    () => parseConfig('GLPI_URL=http://glpi.exemplo.com\nGLPI_USER_TOKEN=falso'),
    /HTTPS/u,
  );
});
