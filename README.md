# MCP local do GLPI

Servidor MCP local para Claude Desktop. O servidor inclui um cliente compartilhado, configuração por arquivo e ferramentas de leitura e gravação para chamados e tarefas de chamado, além de leitura de projetos e tarefas de projeto.

## Requisitos

- Node.js 20 ou superior
- A API REST legada habilitada no GLPI
- Token individual de usuário e, quando exigido pela instância, o token do cliente de API

## Configuração local

Copie [`glpi.example.txt`](glpi.example.txt) para um arquivo local fora deste repositório. Preencha `GLPI_URL`, `GLPI_USER_TOKEN` e `GLPI_APP_TOKEN` com os dados da sua instância. O token do cliente pode ficar vazio quando o GLPI não o exigir. `GLPI_ENABLE_WRITES` fica `false` por padrão; altere para `true` somente quando quiser habilitar ferramentas de gravação naquela instalação local.

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
- `listar_tarefas_chamado` exige `ticket_id` e lista somente as tarefas que a conta pode consultar.
- `listar_tarefas_projeto` exige `project_id` e retorna as tarefas com prazo, estado e progresso.
- `abrir_chamado` e `atualizar_chamado` criam ou atualizam campos selecionados de chamados.
- `criar_tarefa_chamado` e `atualizar_tarefa_chamado` gravam tarefas vinculadas ao chamado indicado por ID; são ferramentas distintas das tarefas de projeto.

As ferramentas de listagem de tarefas aceitam `limit` entre 1 e 50 e `offset` para paginação.

As ferramentas respeitam o perfil e a entidade ativos da conta GLPI. As buscas selecionam campos da API necessários para os resultados, e as consultas por ID retornam somente os campos previstos para cada recurso. Chamados e projetos incluem o link correspondente na interface do GLPI.

O servidor mantém o token de sessão em memória, tenta renová-lo uma vez após uma resposta HTTP 401 e encerra a sessão ao desligar. As respostas de erro não incluem tokens nem mensagens brutas devolvidas pela API.

As gravações usam a API legada com `session_write=true` e respeitam as permissões GLPI da conta configurada. A implementação de gravações de chamados e tarefas foi validada com respostas simuladas; não foi testada contra uma instância de homologação. Em caso de timeout ou resposta parcial, consulte o GLPI antes de repetir a operação para evitar duplicidade. Cada ferramenta de gravação pede confirmação explícita no fluxo do Claude.
