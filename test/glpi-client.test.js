import test from 'node:test';
import assert from 'node:assert/strict';
import { GlpiClient } from '../src/glpi-client.js';

const config = {
  baseUrl: 'https://glpi.exemplo.com/instancia',
  userToken: 'token-de-teste-nao-real',
  appToken: 'app-de-teste-nao-real',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('diagnóstico abre uma sessão, consulta perfil e entidade e a reutiliza', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, headers: options.headers });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/getActiveProfile')) {
      return jsonResponse({ active_profile: { id: 3, name: 'Técnico' } });
    }
    if (url.endsWith('/getActiveEntities')) {
      return jsonResponse({ active_entity: { id: 8, active_entity_recursive: true } });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };

  const client = new GlpiClient(config, fetchMock);
  const result = await client.diagnose();
  assert.deepEqual(result, {
    status: 'connected',
    activeProfile: { id: 3, name: 'Técnico' },
    activeEntity: { id: 8, recursive: true },
  });
  assert.equal(requests.filter(({ url }) => url.endsWith('/initSession')).length, 1);
  assert.ok(requests.every(({ url }) => url.startsWith('https://glpi.exemplo.com/instancia/apirest.php/')));
  assert.ok(requests.every(({ headers }) => headers['App-Token'] === config.appToken));
  await client.close();
});

test('renova a sessão uma vez quando o GLPI rejeita um token expirado', async () => {
  let sessionNumber = 0;
  let profileRejected = false;
  const fetchMock = async (url, options) => {
    if (url.endsWith('/initSession')) {
      sessionNumber += 1;
      return jsonResponse({ session_token: `sessao-${sessionNumber}` });
    }
    if (url.endsWith('/getActiveProfile')) {
      if (options.headers['Session-Token'] === 'sessao-1' && !profileRejected) {
        profileRejected = true;
        return jsonResponse({ message: 'mensagem interna da sessão expirada' }, 401);
      }
      return jsonResponse({ active_profile: { id: 3, name: 'Técnico' } });
    }
    if (url.endsWith('/getActiveEntities')) {
      return jsonResponse({ active_entity: { id: 8, active_entity_recursive: false } });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };

  const client = new GlpiClient(config, fetchMock);
  const result = await client.diagnose();
  assert.equal(sessionNumber, 2);
  assert.equal(result.status, 'connected');
  await client.close();
});

test('traduz rejeição do token e timeout sem expor mensagens de rede', async () => {
  const rejectedClient = new GlpiClient(config, async () =>
    jsonResponse({ message: 'token-de-teste-nao-real e detalhe interno' }, 400));
  await assert.rejects(rejectedClient.diagnose(), (error) => {
    assert.match(error.message, /recusou a autenticação/u);
    assert.doesNotMatch(error.message, /token-de-teste|detalhe interno/u);
    return true;
  });

  const timeoutClient = new GlpiClient(config, async () => {
    const error = new Error('rede privada e token-de-teste-nao-real');
    error.name = 'TimeoutError';
    throw error;
  });
  await assert.rejects(timeoutClient.diagnose(), (error) => {
    assert.match(error.message, /tempo limite/u);
    assert.doesNotMatch(error.message, /token-de-teste|rede privada/u);
    return true;
  });
});

test('não devolve mensagens do servidor que possam conter dados sensíveis', async () => {
  const fetchMock = async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    return jsonResponse({ message: 'resposta privada do servidor' }, 403);
  };
  const client = new GlpiClient(config, fetchMock);

  await assert.rejects(client.diagnose(), (error) => {
    assert.match(error.message, /não tem permissão/u);
    assert.doesNotMatch(error.message, /resposta privada|token-de-teste/u);
    return true;
  });
});

test('busca usa os search options do GLPI e retorna somente campos permitidos', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, headers: options.headers });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/listSearchOptions/Project')) {
      return jsonResponse({
        common: 'Common',
        1: { table: 'glpi_projects', field: 'name' },
        2: { table: 'glpi_projects', field: 'id' },
        3: { table: 'glpi_projects', field: 'priority' },
        5: { table: 'glpi_projects', field: 'percent_done' },
        7: { table: 'glpi_projects', field: 'plan_start_date' },
        8: { table: 'glpi_projects', field: 'plan_end_date' },
        12: { table: 'glpi_projectstates', field: 'name' },
        999: { table: 'glpi_users', field: 'name' },
      });
    }
    if (url.includes('/search/Project?')) {
      return jsonResponse({
        totalcount: 24,
        count: 1,
        data: {
          42: {
            1: 'Projeto exemplo', 2: 42, 3: 3, 5: 60,
            7: '2026-11-01', 8: '2026-11-30', 12: 'Em andamento',
          },
        },
      });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };

  const client = new GlpiClient(config, fetchMock);
  const result = await client.searchItems('Project', { query: 'projeto', offset: 10, limit: 5 });
  assert.equal(result.totalCount, 24);
  assert.deepEqual(result.results, [{
    id: 42,
    name: 'Projeto exemplo',
    status: 'Em andamento',
    priority: 3,
    percentDone: 60,
    planStartDate: '2026-11-01',
    planEndDate: '2026-11-30',
    url: 'https://glpi.exemplo.com/instancia/front/project.form.php?id=42',
  }]);
  const searchUrl = new URL(requests.find(({ url }) => url.includes('/search/Project?')).url);
  assert.equal(searchUrl.searchParams.get('criteria[0][value]'), 'projeto');
  assert.equal(searchUrl.searchParams.get('range'), '10-14');
  assert.ok(requests.every(({ headers }) => headers['App-Token'] === config.appToken));
  await client.close();
});

test('consulta detalhes selecionados e omite campos fora da lista permitida', async () => {
  const fetchMock = async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/Ticket/71')) {
      return jsonResponse({
        id: 71,
        name: 'Chamado exemplo',
        content: 'Descrição de teste',
        status: 1,
        priority: 3,
        entities_id: 8,
        password: 'campo não permitido',
      });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(config, fetchMock);

  const result = await client.getItem('Ticket', 71);
  assert.deepEqual(result, {
    id: 71,
    name: 'Chamado exemplo',
    content: 'Descrição de teste',
    status: 1,
    priority: 3,
    entities_id: 8,
    url: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=71',
  });
  await client.close();
});
