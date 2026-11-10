const REQUEST_TIMEOUT_MS = 15_000;

const RESOURCE_MAP = Object.freeze({
  Ticket: {
    table: 'glpi_tickets',
    form: 'ticket.form.php',
    searchFields: {
      id: ['glpi_tickets', 'id'],
      name: ['glpi_tickets', 'name'],
      status: ['glpi_tickets', 'status'],
      priority: ['glpi_tickets', 'priority'],
    },
    detailFields: [
      'id', 'name', 'content', 'status', 'priority', 'date', 'date_mod',
      'closedate', 'solvedate', 'due_date', 'entities_id', 'locations_id',
      'requesttypes_id', 'users_id_recipient',
    ],
    createFields: [
      'name', 'content', 'type', 'urgency', 'impact', 'priority',
      'itilcategories_id', 'due_date',
    ],
    updateFields: [
      'name', 'content', 'status', 'urgency', 'impact', 'priority',
      'itilcategories_id', 'due_date',
    ],
  },
  Project: {
    table: 'glpi_projects',
    form: 'project.form.php',
    searchFields: {
      id: ['glpi_projects', 'id'],
      name: ['glpi_projects', 'name'],
      status: ['glpi_projectstates', 'name'],
      priority: ['glpi_projects', 'priority'],
      percentDone: ['glpi_projects', 'percent_done'],
      planStartDate: ['glpi_projects', 'plan_start_date'],
      planEndDate: ['glpi_projects', 'plan_end_date'],
    },
    detailFields: [
      'id', 'name', 'content', 'projectstates_id', 'priority', 'percent_done',
      'plan_start_date', 'plan_end_date', 'entities_id', 'users_id', 'date', 'date_mod',
    ],
  },
  TicketTask: {
    parentType: 'Ticket',
    parentForeignKey: 'tickets_id',
    detailFields: [
      'id', 'tickets_id', 'taskcategories_id', 'date', 'users_id', 'users_id_tech',
      'groups_id_tech', 'content', 'is_private', 'actiontime', 'begin', 'end', 'state',
    ],
    createFields: ['content', 'is_private', 'actiontime', 'taskcategories_id'],
    updateFields: ['content', 'is_private', 'actiontime', 'taskcategories_id'],
  },
  ProjectTask: {
    parentType: 'Project',
    parentForeignKey: 'projects_id',
    detailFields: [
      'id', 'projects_id', 'projecttasks_id', 'name', 'content', 'projectstates_id',
      'percent_done', 'plan_start_date', 'plan_end_date', 'is_milestone', 'users_id',
      'date', 'date_mod',
    ],
  },
});

export class GlpiApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GlpiApiError';
    this.status = status;
  }
}

export class GlpiClient {
  #config;
  #fetch;
  #sessionToken;
  #sessionPromise;
  #writeQueue = Promise.resolve();
  #searchOptions = new Map();

  constructor(config, fetchImpl = globalThis.fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async diagnose() {
    const [profile, entityState] = await Promise.all([
      this.#request('getActiveProfile'),
      this.#request('getActiveEntities'),
    ]);

    const activeProfile = profile?.active_profile ?? profile;
    const activeEntity = entityState?.active_entity;
    return {
      status: 'connected',
      activeProfile: {
        id: activeProfile?.id ?? null,
        name: activeProfile?.name ?? null,
      },
      activeEntity: {
        id: activeEntity?.id ?? null,
        recursive: Boolean(activeEntity?.active_entity_recursive),
      },
    };
  }

  async searchItems(itemType, { query, offset, limit }) {
    const resource = this.#getResource(itemType);
    const options = await this.#getSearchOptions(itemType);
    const fields = Object.entries(resource.searchFields).map(([name, [table, field]]) => {
      const option = options.find((candidate) => candidate.table === table && candidate.field === field);
      return option ? [name, option.id] : null;
    }).filter(Boolean);
    const idField = fields.find(([name]) => name === 'id')?.[1];
    const nameField = fields.find(([name]) => name === 'name')?.[1];

    if (!idField || !nameField) {
      throw new GlpiApiError(`A API do GLPI não disponibilizou os campos de identificação de ${itemType}.`);
    }

    const params = new URLSearchParams();
    params.set('criteria[0][link]', 'AND');
    params.set('criteria[0][itemtype]', itemType);
    params.set('criteria[0][field]', nameField);
    params.set('criteria[0][searchtype]', 'contains');
    params.set('criteria[0][value]', query);
    params.set('range', `${offset}-${offset + limit - 1}`);

    const displayFields = fields.map(([, optionId]) => optionId);
    displayFields.forEach((optionId, index) => params.set(`forcedisplay[${index}]`, optionId));

    const payload = await this.#request(`search/${itemType}?${params}`);
    const rows = Array.isArray(payload?.data)
      ? payload.data.map((row, index) => [String(row?.id ?? index), row])
      : Object.entries(payload?.data ?? {});

    return {
      totalCount: Number(payload?.totalcount ?? rows.length),
      results: rows.map(([recordId, row]) => {
        const record = Object.fromEntries(fields.map(([name, optionId]) => [name, row?.[optionId] ?? null]));
        const id = Number(record.id ?? recordId);
        return {
          ...record,
          id,
          url: Number.isSafeInteger(id) && id > 0 ? this.recordUrl(itemType, id) : null,
        };
      }).filter((record) => Number.isSafeInteger(record.id) && record.id > 0),
    };
  }

  async getItem(itemType, id) {
    const resource = this.#getResource(itemType);
    const payload = await this.#request(`${itemType}/${id}`);
    const record = Object.fromEntries(
      resource.detailFields
        .filter((field) => Object.hasOwn(payload ?? {}, field))
        .map((field) => [field, payload[field]]),
    );

    const parentId = resource.parentType ? Number(record[resource.parentForeignKey]) : undefined;
    return {
      ...record,
      id: Number(record.id ?? id),
      url: resource.parentType
        ? Number.isSafeInteger(parentId) && parentId > 0
          ? this.recordUrl(resource.parentType, parentId)
          : null
        : this.recordUrl(itemType, id),
    };
  }

  async listChildItems(parentType, parentId, childType, { offset, limit }) {
    this.#getResource(parentType);
    const childResource = this.#getResource(childType);
    if (childResource.parentType !== parentType || !Number.isSafeInteger(parentId) || parentId <= 0) {
      throw new GlpiApiError('O recurso e o registro de destino não são compatíveis.');
    }

    const end = offset + limit - 1;
    const payload = await this.#request(`${parentType}/${parentId}/${childType}?range=${offset}-${end}`);
    const rawRows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Object.values(payload ?? {});
    const childIds = [...new Set(rawRows
      .filter((row) => row && typeof row === 'object')
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0))];

    const tasks = await mapWithConcurrency(childIds, 4, async (childId) => {
      try {
        // A nested collection can include rows that fail the per-item permission check.
        const task = await this.getItem(childType, childId);
        if (Number(task[childResource.parentForeignKey]) !== parentId) {
          return null;
        }
        return task;
      } catch (error) {
        if (error instanceof GlpiApiError && [401, 403, 404].includes(error.status)) {
          return null;
        }
        throw error;
      }
    });

    return {
      parentId,
      parentUrl: this.recordUrl(parentType, parentId),
      tasks: tasks.filter(Boolean),
    };
  }

  async createTicket(input) {
    const fields = this.#pickWritableFields('Ticket', input, 'createFields');
    requireText(fields.name, 'O chamado precisa de um título.');
    requireText(fields.content, 'O chamado precisa de uma descrição.');
    return this.#createItem('Ticket', fields);
  }

  async updateTicket(id, input) {
    const fields = this.#pickWritableFields('Ticket', input, 'updateFields');
    return this.#updateItem('Ticket', id, fields);
  }

  async createTicketTask(ticketId, input) {
    this.#assertWritesEnabled();
    requirePositiveId(ticketId, 'ID do chamado');
    const fields = this.#pickWritableFields('TicketTask', input, 'createFields');
    requireText(fields.content, 'A tarefa precisa de uma descrição.');
    return this.#createItem('TicketTask', { ...fields, tickets_id: ticketId }, ticketId);
  }

  async updateTicketTask(ticketId, taskId, input) {
    this.#assertWritesEnabled();
    requirePositiveId(ticketId, 'ID do chamado');
    requirePositiveId(taskId, 'ID da tarefa');
    const fields = this.#pickWritableFields('TicketTask', input, 'updateFields');
    const task = await this.getItem('TicketTask', taskId);
    if (Number(task.tickets_id) !== ticketId) {
      throw new GlpiApiError('A tarefa não pertence ao chamado informado.');
    }

    return this.#updateItem('TicketTask', taskId, fields, ticketId);
  }

  recordUrl(itemType, id) {
    const resource = this.#getResource(itemType);
    const base = this.#config.baseUrl.replace(/\/apirest\.php\/?$/u, '').replace(/\/$/u, '');
    return `${base}/front/${resource.form}?id=${encodeURIComponent(String(id))}`;
  }

  async close() {
    const sessionToken = this.#sessionToken;
    this.#sessionToken = undefined;
    if (!sessionToken) {
      return;
    }

    try {
      await this.#send('killSession', { 'Session-Token': sessionToken });
    } catch {
      // Encerrar o processo não deve expor nem propagar erros de sessão.
    }
  }

  async #request(path, { method = 'GET', body } = {}) {
    let sessionToken = await this.#getSession();
    let response = await this.#send(path, { 'Session-Token': sessionToken }, { method, body });

    if (response.status === 401) {
      this.#sessionToken = undefined;
      sessionToken = await this.#getSession();
      response = await this.#send(path, { 'Session-Token': sessionToken }, { method, body });
    }

    if (response.status === 207) {
      throw new GlpiApiError(
        'O GLPI retornou uma gravação parcial. Confira o registro no GLPI antes de repetir a operação.',
        response.status,
      );
    }

    if (!response.ok) {
      throw new GlpiApiError(this.#messageForStatus(response.status, method !== 'GET'), response.status);
    }

    try {
      return await this.#readJson(response);
    } catch (error) {
      if (method !== 'GET') {
        throw new GlpiApiError(
          'Não foi possível confirmar o resultado da gravação. Consulte o GLPI antes de repetir a operação.',
          response.status,
        );
      }
      throw error;
    }
  }

  #assertWritesEnabled() {
    if (!this.#config.writesEnabled) {
      throw new GlpiApiError('As gravações estão desativadas. Defina GLPI_ENABLE_WRITES=true no arquivo local para habilitá-las.');
    }
  }

  #pickWritableFields(itemType, input, fieldSet) {
    this.#assertWritesEnabled();
    const resource = this.#getResource(itemType);
    const allowed = resource[fieldSet];
    if (!allowed) {
      throw new GlpiApiError('Gravações não implementadas para este tipo de registro.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new GlpiApiError('Os campos da gravação são inválidos.');
    }

    const fields = Object.fromEntries(
      allowed
        .filter((field) => Object.hasOwn(input, field) && input[field] !== undefined)
        .map((field) => [field, input[field]]),
    );
    if (Object.keys(fields).length === 0) {
      throw new GlpiApiError('Informe ao menos um campo permitido para atualizar.');
    }
    return fields;
  }

  async #createItem(itemType, input, parentId) {
    this.#assertWritesEnabled();
    return this.#serializeWrite(async () => {
      const payload = await this.#request(`${itemType}/?session_write=true`, {
        method: 'POST',
        body: { input },
      });
      const id = Number(payload?.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new GlpiApiError('O GLPI não confirmou o ID criado. Consulte o registro antes de tentar novamente.');
      }

      const resource = this.#getResource(itemType);
      const recordParentId = resource.parentType ? parentId : undefined;
      const url = resource.parentType
        ? this.recordUrl(resource.parentType, recordParentId)
        : this.recordUrl(itemType, id);
      return {
        id,
        ...(recordParentId ? { parentId: recordParentId } : {}),
        url,
      };
    });
  }

  async #updateItem(itemType, id, input, parentId) {
    this.#assertWritesEnabled();
    requirePositiveId(id, 'ID do registro');
    const resource = this.#getResource(itemType);
    if (!resource.updateFields) {
      throw new GlpiApiError('Gravações não implementadas para este tipo de registro.');
    }

    const fields = this.#pickWritableFields(itemType, input, 'updateFields');
    return this.#serializeWrite(async () => {
      const payload = await this.#request(`${itemType}/${id}?session_write=true`, {
        method: 'PUT',
        body: { input: { id, ...fields } },
      });
      if (!isUpdateConfirmed(payload, id)) {
        throw new GlpiApiError('O GLPI não confirmou a atualização. Consulte o registro antes de repetir a operação.');
      }

      const recordParentId = resource.parentType ? parentId : undefined;
      const url = resource.parentType
        ? this.recordUrl(resource.parentType, recordParentId)
        : this.recordUrl(itemType, id);
      return {
        id,
        ...(recordParentId ? { parentId: recordParentId } : {}),
        url,
      };
    });
  }

  #serializeWrite(operation) {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.catch(() => undefined);
    return result;
  }

  async #getSession() {
    if (this.#sessionToken) {
      return this.#sessionToken;
    }
    if (this.#sessionPromise) {
      return this.#sessionPromise;
    }

    this.#sessionPromise = this.#createSession();
    try {
      this.#sessionToken = await this.#sessionPromise;
      return this.#sessionToken;
    } finally {
      this.#sessionPromise = undefined;
    }
  }

  async #createSession() {
    const headers = { Authorization: `user_token ${this.#config.userToken}` };
    if (this.#config.appToken) {
      headers['App-Token'] = this.#config.appToken;
    }

    const response = await this.#send('initSession', headers);
    if (!response.ok) {
      throw new GlpiApiError(this.#messageForStatus(response.status), response.status);
    }

    const payload = await this.#readJson(response);
    if (typeof payload?.session_token !== 'string' || !payload.session_token) {
      throw new GlpiApiError('O GLPI não retornou um token de sessão válido.', response.status);
    }
    return payload.session_token;
  }

  async #getSearchOptions(itemType) {
    if (this.#searchOptions.has(itemType)) {
      return this.#searchOptions.get(itemType);
    }

    const payload = await this.#request(`listSearchOptions/${itemType}`);
    const options = Object.entries(payload ?? {})
      .filter(([id, option]) => /^\d+$/u.test(id) && typeof option?.table === 'string' && typeof option?.field === 'string')
      .map(([id, option]) => ({ id, table: option.table, field: option.field }));
    this.#searchOptions.set(itemType, options);
    return options;
  }

  #getResource(itemType) {
    const resource = RESOURCE_MAP[itemType];
    if (!resource) {
      throw new GlpiApiError('Tipo de registro não suportado.');
    }
    return resource;
  }

  async #send(path, extraHeaders = {}, { method = 'GET', body } = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (this.#config.appToken) {
      headers['App-Token'] = this.#config.appToken;
    }

    let response;
    try {
      response = await this.#fetch(this.#endpoint(path), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      if (method !== 'GET') {
        throw new GlpiApiError(
          'Não foi possível confirmar o resultado da gravação. Consulte o GLPI antes de repetir a operação.',
        );
      }
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new GlpiApiError('A conexão com o GLPI excedeu o tempo limite.');
      }
      throw new GlpiApiError('Não foi possível conectar ao GLPI. Verifique a URL e a rede.');
    }

    return response;
  }

  #endpoint(path) {
    const base = this.#config.baseUrl.replace(/\/$/u, '');
    const apiBase = base.endsWith('/apirest.php') ? base : `${base}/apirest.php`;
    return `${apiBase}/${path}`;
  }

  async #readJson(response) {
    try {
      return await response.json();
    } catch {
      throw new GlpiApiError('O GLPI retornou uma resposta inválida.', response.status);
    }
  }

  #messageForStatus(status, isWrite = false) {
    if (isWrite && ![400, 401, 403, 404, 405, 409, 422].includes(status)) {
      return 'Não foi possível confirmar o resultado da gravação. Consulte o GLPI antes de repetir a operação.';
    }
    if (status === 400 && isWrite) {
      return 'O GLPI recusou os campos enviados. Confira os valores e os campos permitidos.';
    }
    if (status === 400 || status === 401) {
      return 'O GLPI recusou a autenticação. Confira a URL e os tokens no arquivo local.';
    }
    if (status === 403) {
      return 'A conta autenticou, mas não tem permissão para esta operação.';
    }
    if (status === 404) {
      return 'Registro não encontrado ou sem permissão de leitura.';
    }
    return `O GLPI respondeu com HTTP ${status}.`;
  }
}

function requireText(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GlpiApiError(message);
  }
}

function requirePositiveId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GlpiApiError(`${label} precisa ser um inteiro positivo.`);
  }
}

function isUpdateConfirmed(payload, id) {
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.some((row) => row && typeof row === 'object' && row[String(id)] === true);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  const errors = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        errors[index] = error;
      }
    }
  });

  await Promise.all(workers);
  const firstError = errors.find(Boolean);
  if (firstError) {
    throw firstError;
  }
  return results;
}
