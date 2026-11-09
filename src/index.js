import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigurationError, loadConfig } from './config.js';
import { GlpiApiError, GlpiClient } from './glpi-client.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'mcp-glpi-local',
  version: '0.2.0',
});

let clientPromise;

function toolError(error) {
  if (error instanceof ConfigurationError || error instanceof GlpiApiError) {
    return error.message;
  }
  return 'Falha inesperada ao executar a operação no GLPI.';
}

function registerSearchTool(name, title, itemType, description) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe('Texto para procurar no nome do registro.'),
        limit: z.number().int().min(1).max(50).default(10).describe('Quantidade máxima de resultados.'),
        offset: z.number().int().min(0).max(1_000_000).default(0).describe('Deslocamento para paginação, começando em zero.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, offset }) => {
      try {
        const client = await getClient();
        const result = await client.searchItems(itemType, { query, limit, offset });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { content: [{ type: 'text', text: toolError(error) }], isError: true };
      }
    },
  );
}

function registerGetTool(name, title, itemType, description) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: { id: z.number().int().positive().describe('ID do registro no GLPI.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const client = await getClient();
        const result = await client.getItem(itemType, id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { content: [{ type: 'text', text: toolError(error) }], isError: true };
      }
    },
  );
}

function registerTaskListTool(name, title, parentIdField, parentType, childType, description) {
  const parentIdLabel = parentType === 'Ticket' ? 'ID do chamado' : 'ID do projeto';
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: {
        [parentIdField]: z.number().int().positive().describe(parentIdLabel),
        limit: z.number().int().min(1).max(50).default(20).describe('Quantidade máxima de tarefas.'),
        offset: z.number().int().min(0).max(1_000_000).default(0).describe('Deslocamento para paginação, começando em zero.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const client = await getClient();
        const result = await client.listChildItems(
          parentType,
          input[parentIdField],
          childType,
          { limit: input.limit, offset: input.offset },
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { content: [{ type: 'text', text: toolError(error) }], isError: true };
      }
    },
  );
}

function registerMutationTool(name, title, description, inputSchema, handler) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        const client = await getClient();
        const result = await handler(client, input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return { content: [{ type: 'text', text: toolError(error) }], isError: true };
      }
    },
  );
}

const glpiDateTime = z.string().trim().regex(
  /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/u,
  'Use AAAA-MM-DD ou AAAA-MM-DD HH:mm:ss.',
);
const ticketFields = {
  name: z.string().trim().min(1).max(255).optional().describe('Título do chamado.'),
  content: z.string().trim().min(1).max(10_000).optional().describe('Descrição do chamado.'),
  priority: z.number().int().min(1).max(6).optional().describe('Prioridade GLPI, de 1 a 6.'),
  urgency: z.number().int().min(1).max(5).optional().describe('Urgência GLPI, de 1 a 5.'),
  impact: z.number().int().min(1).max(5).optional().describe('Impacto GLPI, de 1 a 5.'),
  itilcategories_id: z.number().int().positive().optional().describe('ID da categoria ITIL, se conhecida.'),
  due_date: glpiDateTime.optional().describe('Prazo no formato AAAA-MM-DD ou AAAA-MM-DD HH:mm:ss.'),
};
const ticketTaskFields = {
  content: z.string().trim().min(1).max(10_000).optional().describe('Descrição da tarefa.'),
  is_private: z.boolean().optional().describe('Define se a tarefa é privada. A API aplica as permissões da conta.'),
  actiontime: z.number().int().min(0).max(2_147_483_647).optional().describe('Tempo registrado em segundos.'),
  taskcategories_id: z.number().int().positive().optional().describe('ID da categoria da tarefa, se conhecida.'),
};

async function getClient() {
  if (!clientPromise) {
    clientPromise = loadConfig(process.env.GLPI_CONFIG_PATH).then(
      (config) => new GlpiClient(config),
    );
  }
  return clientPromise;
}

server.registerTool(
  'diagnosticar_conexao',
  {
    title: 'Diagnosticar conexão com o GLPI',
    description: 'Testa a autenticação e informa o perfil e a entidade ativos da conta configurada.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const client = await getClient();
      const result = await client.diagnose();
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: toolError(error) }], isError: true };
    }
  },
);

registerSearchTool(
  'buscar_chamados',
  'Buscar chamados',
  'Ticket',
  'Busca chamados pelo nome, respeitando o perfil e a entidade ativos da conta GLPI. Retorna paginação, status, prioridade e link.',
);
registerGetTool(
  'consultar_chamado',
  'Consultar chamado por ID',
  'Ticket',
  'Consulta um chamado pelo ID e retorna os campos principais disponíveis para a conta GLPI.',
);
registerSearchTool(
  'buscar_projetos',
  'Buscar projetos',
  'Project',
  'Busca projetos pelo nome, respeitando o perfil e a entidade ativos da conta GLPI. Retorna paginação, status, prioridade, progresso, prazo e link.',
);
registerGetTool(
  'consultar_projeto',
  'Consultar projeto por ID',
  'Project',
  'Consulta um projeto pelo ID e retorna os campos principais disponíveis para a conta GLPI.',
);
registerTaskListTool(
  'listar_tarefas_chamado',
  'Listar tarefas do chamado',
  'ticket_id',
  'Ticket',
  'TicketTask',
  'Lista tarefas de um chamado pelo ID. Inclui tarefas privadas somente quando a conta configurada tem permissão de leitura.',
);
registerTaskListTool(
  'listar_tarefas_projeto',
  'Listar tarefas do projeto',
  'project_id',
  'Project',
  'ProjectTask',
  'Lista tarefas de um projeto pelo ID e retorna prazo, estado e progresso disponíveis para a conta GLPI.',
);

registerMutationTool(
  'abrir_chamado',
  'Abrir chamado',
  'Cria um novo chamado executando como a conta GLPI configurada. A ferramenta não aceita trocar entidade nem informar outro usuário; o GLPI aplica o perfil e a entidade ativa. Requer GLPI_ENABLE_WRITES=true e confirmação explícita do usuário para esta gravação.',
  {
    name: ticketFields.name.unwrap(),
    content: ticketFields.content.unwrap(),
    type: z.number().int().min(1).max(2).optional().describe('Tipo GLPI: 1 incidente, 2 requisição.'),
    priority: ticketFields.priority,
    urgency: ticketFields.urgency,
    impact: ticketFields.impact,
    itilcategories_id: ticketFields.itilcategories_id,
    due_date: ticketFields.due_date,
  },
  (client, input) => client.createTicket(input),
);

registerMutationTool(
  'atualizar_chamado',
  'Atualizar chamado',
  'Atualiza somente título, descrição, status, prioridade, urgência, impacto, categoria ou prazo do chamado indicado. Use o ID do resultado escolhido; se a busca tiver nomes repetidos, apresente as opções e aguarde a escolha explícita antes de gravar. O GLPI aplica as permissões da conta. Requer GLPI_ENABLE_WRITES=true e confirmação explícita do usuário para esta gravação.',
  {
    id: z.number().int().positive().describe('ID do chamado a atualizar.'),
    ...ticketFields,
    status: z.number().int().min(1).max(6).optional().describe('Status GLPI de 1 a 6.'),
  },
  (client, { id, ...input }) => client.updateTicket(id, input),
);

registerMutationTool(
  'criar_tarefa_chamado',
  'Criar tarefa de chamado',
  'Cria uma tarefa vinculada ao chamado indicado pelo ticket_id. Não use esta ferramenta para tarefas de projeto. Para nomes repetidos, apresente os chamados encontrados e aguarde a escolha explícita antes de gravar. A autoria é definida pela conta GLPI; tarefas privadas continuam sujeitas às permissões dela. Requer GLPI_ENABLE_WRITES=true e confirmação explícita do usuário para esta gravação.',
  {
    ticket_id: z.number().int().positive().describe('ID do chamado de destino.'),
    content: z.string().trim().min(1).max(10_000).describe('Descrição da tarefa.'),
    is_private: z.boolean().default(false).describe('Define se a tarefa será privada.'),
    actiontime: ticketTaskFields.actiontime,
    taskcategories_id: ticketTaskFields.taskcategories_id,
  },
  (client, { ticket_id, ...input }) => client.createTicketTask(ticket_id, input),
);

registerMutationTool(
  'atualizar_tarefa_chamado',
  'Atualizar tarefa de chamado',
  'Atualiza uma tarefa de chamado identificada por ticket_id e task_id. O servidor confere que a tarefa pertence ao chamado antes da gravação. Se o chamado for identificado por nome e a busca retornar nomes repetidos, apresente as opções e aguarde a escolha explícita. Não use para tarefas de projeto. Requer GLPI_ENABLE_WRITES=true e confirmação explícita do usuário para esta gravação.',
  {
    ticket_id: z.number().int().positive().describe('ID do chamado ao qual a tarefa pertence.'),
    task_id: z.number().int().positive().describe('ID da tarefa de chamado.'),
    ...ticketTaskFields,
  },
  (client, { ticket_id, task_id, ...input }) => client.updateTicketTask(ticket_id, task_id, input),
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function shutdown() {
  try {
    const client = await clientPromise;
    await client?.close();
  } catch {
    // O servidor pode encerrar normalmente sem configuração ou sem sessão ativa.
  }
  await server.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
