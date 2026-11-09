import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigurationError, loadConfig } from './config.js';
import { GlpiApiError, GlpiClient } from './glpi-client.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'mcp-glpi-local',
  version: '0.1.0',
});

let clientPromise;

function toolError(error) {
  if (error instanceof ConfigurationError || error instanceof GlpiApiError) {
    return error.message;
  }
  return 'Falha inesperada ao consultar o GLPI.';
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
