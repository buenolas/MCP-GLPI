import test from 'node:test';
import assert from 'node:assert/strict';
import { GlpiClient } from '../src/glpi-client.js';

const config = {
  baseUrl: 'https://glpi.exemplo.com/instancia',
  userToken: 'token-de-teste-nao-real',
  appToken: 'app-de-teste-nao-real',
};
const writeConfig = { ...config, writesEnabled: true };

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
    if (url.endsWith('/getFullSession')) {
      return jsonResponse({ session: {
        glpiID: '33',
        glpifirstname: 'Ana',
        glpirealname: 'Silva',
        glpiname: 'asilva',
        glpiactive_entity_name: 'Atendimento',
        privateValue: 'não deve sair',
      } });
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
    userId: 33,
    userName: 'Ana Silva',
    activeProfile: { id: 3, name: 'Técnico' },
    activeEntity: { id: 8, name: 'Atendimento', recursive: true },
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
    if (url.endsWith('/getFullSession')) {
      return jsonResponse({ session: { glpiID: '33', privateValue: 'não deve sair' } });
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

test('lista tarefas de chamado e valida o acesso individual e o chamado de origem', async () => {
  let sessionCount = 0;
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, headers: options.headers });
    if (url.endsWith('/initSession')) {
      sessionCount += 1;
      return jsonResponse({ session_token: `sessao-${sessionCount}` });
    }
    if (url.includes('/Ticket/77/TicketTask?')) {
      return jsonResponse([{ id: 301 }, { id: 302 }, { id: 303 }, { id: 304 }]);
    }
    if (url.endsWith('/TicketTask/301')) {
      return jsonResponse({
        id: 301,
        tickets_id: 77,
        content: 'Tarefa visível',
        date: '2026-11-08 10:00:00',
        is_private: 0,
        actiontime: 600,
        state: 1,
        password: 'campo não permitido',
      });
    }
    if (url.endsWith('/TicketTask/302')) {
      return jsonResponse(['ERROR_RIGHT_MISSING', 'mensagem interna do GLPI'], 403);
    }
    if (url.endsWith('/TicketTask/303')) {
      return jsonResponse({ id: 303, tickets_id: 78, content: 'Outro chamado' });
    }
    if (url.endsWith('/TicketTask/304')) {
      return jsonResponse({ id: 304, tickets_id: 77, content: 'Tarefa privada autorizada', is_private: 1 });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };

  const client = new GlpiClient(config, fetchMock);
  const result = await client.listChildItems('Ticket', 77, 'TicketTask', { offset: 0, limit: 10 });
  assert.deepEqual(result, {
    parentId: 77,
    parentUrl: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=77',
    tasks: [
      {
        id: 301,
        tickets_id: 77,
        content: 'Tarefa visível',
        date: '2026-11-08 10:00:00',
        is_private: 0,
        actiontime: 600,
        state: 1,
        url: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=77',
      },
      {
        id: 304,
        tickets_id: 77,
        content: 'Tarefa privada autorizada',
        is_private: 1,
        url: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=77',
      },
    ],
  });
  assert.equal(sessionCount, 1);
  assert.ok(requests.some(({ url }) => url.includes('/Ticket/77/TicketTask?range=0-9')));
  assert.ok(requests.every(({ headers }) => headers['App-Token'] === config.appToken));
  await client.close();
});

test('lista tarefas de projeto e devolve campos de prazo, estado e progresso', async () => {
  const fetchMock = async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.includes('/Project/19/ProjectTask?')) {
      return jsonResponse([{ id: 401 }]);
    }
    if (url.endsWith('/ProjectTask/401')) {
      return jsonResponse({
        id: 401,
        projects_id: 19,
        projecttasks_id: 0,
        name: 'Tarefa de projeto',
        content: 'Detalhes',
        projectstates_id: 2,
        percent_done: 45,
        plan_start_date: '2026-11-01',
        plan_end_date: '2026-11-30',
        is_milestone: 0,
        users_id: 9,
        date: '2026-10-31 12:00:00',
        date_mod: '2026-11-01 09:00:00',
      });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(config, fetchMock);

  const result = await client.listChildItems('Project', 19, 'ProjectTask', { offset: 0, limit: 20 });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].projects_id, 19);
  assert.equal(result.tasks[0].percent_done, 45);
  assert.equal(result.tasks[0].projectstates_id, 2);
  assert.equal(result.tasks[0].plan_end_date, '2026-11-30');
  assert.equal(result.tasks[0].url, 'https://glpi.exemplo.com/instancia/front/projecttask.form.php?id=401');
  await client.close();
});

test('bloqueia gravações por padrão antes de abrir uma sessão', async () => {
  let requestCount = 0;
  const client = new GlpiClient(config, async () => {
    requestCount += 1;
    return jsonResponse({ session_token: 'sessao-ficticia' });
  });

  await assert.rejects(client.createTicket({ name: 'Chamado de teste', content: 'Descrição' }), /gravações estão desativadas/u);
  assert.equal(requestCount, 0);
});

test('cria e atualiza chamado com POST/PUT, session_write e campos em allowlist', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/Ticket/?session_write=true') && options.method === 'POST') {
      return jsonResponse({ id: 91, message: 'criado' }, 201);
    }
    if (url.endsWith('/Ticket/91?session_write=true') && options.method === 'PUT') {
      return jsonResponse([{ 91: true, message: '' }]);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const created = await client.createTicket({
    name: 'Chamado de teste',
    content: 'Descrição de teste',
    priority: 3,
    entities_id: 999,
    users_id_recipient: 999,
  });
  const updated = await client.updateTicket(91, { priority: 2, users_id_recipient: 999 });

  assert.deepEqual(created, {
    id: 91,
    url: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=91',
  });
  assert.deepEqual(updated, created);

  const createRequest = requests.find(({ method, url }) => method === 'POST' && url.includes('/Ticket/'));
  assert.equal(createRequest.headers['Content-Type'], 'application/json');
  assert.equal(createRequest.headers['App-Token'], config.appToken);
  assert.deepEqual(JSON.parse(createRequest.body), {
    input: { name: 'Chamado de teste', content: 'Descrição de teste', priority: 3 },
  });

  const updateRequest = requests.find(({ method, url }) => method === 'PUT');
  assert.ok(updateRequest.url.includes('session_write=true'));
  assert.deepEqual(JSON.parse(updateRequest.body), { input: { id: 91, priority: 2 } });
  await client.close();
});

test('cria tarefa de chamado com vínculo explícito e devolve o link do chamado', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/TicketTask/?session_write=true') && options.method === 'POST') {
      return jsonResponse({ id: 301, message: 'criada' }, 201);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const result = await client.createTicketTask(77, {
    content: 'Tarefa de teste',
    is_private: true,
    actiontime: 600,
    users_id: 999,
  });

  assert.deepEqual(result, {
    id: 301,
    parentId: 77,
    url: 'https://glpi.exemplo.com/instancia/front/ticket.form.php?id=77',
  });
  const createRequest = requests.find(({ method }) => method === 'POST');
  assert.deepEqual(JSON.parse(createRequest.body), {
    input: { content: 'Tarefa de teste', is_private: true, actiontime: 600, tickets_id: 77 },
  });
  await client.close();
});

test('confere o chamado de origem antes de atualizar uma tarefa e bloqueia vínculo incompatível', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/TicketTask/301')) {
      return jsonResponse({ id: 301, tickets_id: 78, content: 'Tarefa existente' });
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  await assert.rejects(
    client.updateTicketTask(77, 301, { content: 'Novo conteúdo' }),
    /não pertence ao chamado informado/u,
  );
  assert.equal(requests.some(({ method }) => method === 'PUT'), false);
  await client.close();
});

test('trata resposta parcial e falha de rede de gravação sem expor detalhes', async () => {
  const partialClient = new GlpiClient(writeConfig, async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    return jsonResponse({ message: 'resposta interna confidencial' }, 207);
  });
  await assert.rejects(
    partialClient.createTicket({ name: 'Chamado de teste', content: 'Descrição' }),
    (error) => {
      assert.match(error.message, /gravação parcial/u);
      assert.match(error.message, /antes de repetir/u);
      assert.doesNotMatch(error.message, /confidencial/u);
      return true;
    },
  );

  const networkClient = new GlpiClient(writeConfig, async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    throw new Error('app-de-teste-nao-real e detalhe privado');
  });
  await assert.rejects(
    networkClient.createTicket({ name: 'Chamado de teste', content: 'Descrição' }),
    (error) => {
      assert.match(error.message, /Consulte o GLPI antes/u);
      assert.doesNotMatch(error.message, /app-de-teste|detalhe privado/u);
      return true;
    },
  );
});

test('serializa gravações para não concorrer com sessões em modo de escrita', async () => {
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let nextId = 1;
  const fetchMock = async (url, options) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/Ticket/?session_write=true') && options.method === 'POST') {
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWrites -= 1;
      nextId += 1;
      return jsonResponse({ id: nextId, message: 'criado' }, 201);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const results = await Promise.all([
    client.createTicket({ name: 'Chamado A', content: 'Descrição A' }),
    client.createTicket({ name: 'Chamado B', content: 'Descrição B' }),
  ]);

  assert.equal(results.length, 2);
  assert.equal(maxActiveWrites, 1);
  await client.close();
});

test('não declara atualização concluída quando o GLPI devolve falha no corpo', async () => {
  const fetchMock = async (url) => {
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/Ticket/91?session_write=true')) {
      return jsonResponse([{ 91: false, message: 'detalhe interno confidencial' }]);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  await assert.rejects(
    client.updateTicket(91, { priority: 2 }),
    (error) => {
      assert.match(error.message, /não confirmou a atualização/u);
      assert.doesNotMatch(error.message, /confidencial/u);
      return true;
    },
  );
});

test('lista estados de projeto com IDs e nomes e paginação limitada', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/ProjectState/?range=10-19')) {
      return jsonResponse({
        totalcount: 12,
        data: [{ id: 11, name: 'Em andamento' }, { id: 12, name: 'Concluído', color: '#fff' }],
      }, 206);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const result = await client.listProjectStates({ offset: 10, limit: 10 });
  assert.deepEqual(result, {
    totalCount: 12,
    results: [{ id: 11, name: 'Em andamento' }, { id: 12, name: 'Concluído' }],
  });
  assert.ok(requests.some(({ url }) => url.endsWith('/ProjectState/?range=10-19')));
  await client.close();
});

test('cria e atualiza projeto com campos permitidos e link do projeto', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/Project/?session_write=true') && options.method === 'POST') {
      return jsonResponse({ id: 510, message: 'criado' }, 201);
    }
    if (url.endsWith('/Project/510?session_write=true') && options.method === 'PUT') {
      return jsonResponse([{ 510: true, message: '' }]);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const created = await client.createProject({
    name: 'Projeto de teste',
    content: 'Descrição',
    projectstates_id: 2,
    priority: 3,
    percent_done: 20,
    plan_start_date: '2026-11-10',
    plan_end_date: '2026-12-01',
    entities_id: 999,
    users_id: 999,
  });
  const updated = await client.updateProject(510, { percent_done: 50, projectstates_id: 3 });

  assert.deepEqual(created, {
    id: 510,
    url: 'https://glpi.exemplo.com/instancia/front/project.form.php?id=510',
  });
  assert.deepEqual(updated, created);
  const createRequest = requests.find(({ method }) => method === 'POST');
  assert.deepEqual(JSON.parse(createRequest.body), {
    input: {
      name: 'Projeto de teste',
      content: 'Descrição',
      projectstates_id: 2,
      priority: 3,
      percent_done: 20,
      plan_start_date: '2026-11-10',
      plan_end_date: '2026-12-01',
    },
  });
  await client.close();
});

test('cria tarefa de projeto com projeto de destino, estado manual e link do projeto', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/ProjectTask/?session_write=true') && options.method === 'POST') {
      return jsonResponse({ id: 611, message: 'criada' }, 201);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  const result = await client.createProjectTask(510, {
    name: 'Tarefa de projeto',
    content: 'Preparar entrega',
    projectstates_id: 2,
    percent_done: 25,
    plan_end_date: '2026-12-15',
    users_id: 999,
  });

  assert.deepEqual(result, {
    id: 611,
    parentId: 510,
    url: 'https://glpi.exemplo.com/instancia/front/projecttask.form.php?id=611',
  });
  const createRequest = requests.find(({ method }) => method === 'POST');
  assert.deepEqual(JSON.parse(createRequest.body), {
    input: {
      name: 'Tarefa de projeto',
      content: 'Preparar entrega',
      projectstates_id: 2,
      percent_done: 25,
      plan_end_date: '2026-12-15',
      auto_projectstates: false,
      projects_id: 510,
    },
  });
  await client.close();
});

test('verifica projeto e estado automático antes da atualização manual de tarefa de projeto', async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, ...options });
    if (url.endsWith('/initSession')) {
      return jsonResponse({ session_token: 'sessao-ficticia' });
    }
    if (url.endsWith('/ProjectTask/611')) {
      return jsonResponse({ id: 611, projects_id: 510, projectstates_id: 2, auto_projectstates: '1' });
    }
    if (url.endsWith('/ProjectTask/611?session_write=true') && options.method === 'PUT') {
      return jsonResponse([{ 611: true, message: '' }]);
    }
    if (url.endsWith('/killSession')) {
      return jsonResponse({});
    }
    throw new Error('Rota inesperada no teste.');
  };
  const client = new GlpiClient(writeConfig, fetchMock);

  await assert.rejects(
    client.updateProjectTask(510, 611, { projectstates_id: 3 }),
    /estado automático/u,
  );
  assert.equal(requests.some(({ method }) => method === 'PUT'), false);

  const result = await client.updateProjectTask(510, 611, {
    projectstates_id: 3,
    auto_projectstates: false,
    percent_done: 50,
    plan_end_date: '2026-12-20',
  });
  assert.deepEqual(result, {
    id: 611,
    parentId: 510,
    url: 'https://glpi.exemplo.com/instancia/front/projecttask.form.php?id=611',
  });
  const updateRequest = requests.find(({ method }) => method === 'PUT');
  assert.deepEqual(JSON.parse(updateRequest.body), {
    input: {
      id: 611,
      projectstates_id: 3,
      auto_projectstates: false,
      percent_done: 50,
      plan_end_date: '2026-12-20',
    },
  });
  await client.close();
});

test('recusa progresso inválido, datas invertidas e datas impossíveis antes da gravação', async () => {
  let requestCount = 0;
  const client = new GlpiClient(writeConfig, async () => {
    requestCount += 1;
    return jsonResponse({ session_token: 'sessao-ficticia' });
  });

  await assert.rejects(
    client.createProjectTask(510, {
      name: 'Tarefa inválida',
      percent_done: 101,
    }),
    /progresso precisa ser/u,
  );
  await assert.rejects(
    client.createProjectTask(510, {
      name: 'Tarefa inválida',
      plan_start_date: '2026-12-20',
      plan_end_date: '2026-12-10',
    }),
    /prazo planejado não pode ser anterior/u,
  );
  await assert.rejects(
    client.createProjectTask(510, {
      name: 'Tarefa inválida',
      plan_start_date: '2026-02-30',
    }),
    /formato AAAA-MM-DD/u,
  );
  assert.equal(requestCount, 0);
});
