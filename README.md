# MCP local do GLPI

Servidor MCP local para Claude Desktop. O servidor inclui um cliente compartilhado, configuração por arquivo e ferramentas de leitura para chamados e projetos.

## Requisitos

- Node.js 20 ou superior
- A API REST legada habilitada no GLPI
- Token individual de usuário e, quando exigido pela instância, o token do cliente de API

## Configuração local

Copie [`glpi.example.txt`](glpi.example.txt) para um arquivo local fora deste repositório. Preencha `GLPI_URL`, `GLPI_USER_TOKEN` e `GLPI_APP_TOKEN` com os dados da sua instância. O token do cliente pode ficar vazio quando o GLPI não o exigir.

Indique ao servidor o caminho absoluto desse arquivo por meio da variável `GLPI_CONFIG_PATH`. Não compartilhe nem inclua o arquivo preenchido no GitHub.

## Desenvolvimento

```powershell
npm install
npm test
$env:GLPI_CONFIG_PATH = 'C:\caminho\privado\glpi.txt'
npm start
```

O servidor usa o transporte MCP `stdio`. No Claude Desktop, o comando local de desenvolvimento pode ser configurado para iniciar `node` com o caminho absoluto de `src/index.js` e definir `GLPI_CONFIG_PATH` no ambiente do servidor. A extensão `.mcpb` será preparada na etapa de empacotamento.

## Ferramentas disponíveis

- `diagnosticar_conexao` testa a sessão e informa o perfil e a entidade ativos.
- `buscar_chamados` e `buscar_projetos` pesquisam pelo nome. Aceitam `limit` entre 1 e 50 e `offset` para paginação.
- `consultar_chamado` e `consultar_projeto` consultam um registro pelo ID.

As ferramentas respeitam o perfil e a entidade ativos da conta GLPI. As buscas selecionam campos da API necessários para os resultados, e as consultas por ID retornam somente os campos previstos para cada recurso. Chamados e projetos incluem o link correspondente na interface do GLPI.

O servidor mantém o token de sessão em memória, tenta renová-lo uma vez após uma resposta HTTP 401 e encerra a sessão ao desligar. As respostas de erro não incluem tokens nem mensagens brutas devolvidas pela API.
