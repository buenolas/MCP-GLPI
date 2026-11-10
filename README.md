# MCP local do GLPI

Servidor MCP local para Claude Desktop. O servidor inclui um cliente compartilhado, configuração por arquivo e ferramentas de leitura e gravação para chamados, tarefas de chamado, projetos e tarefas de projeto.

## Requisitos

- Claude Desktop atualizado
- Node.js 20 ou superior somente para desenvolvimento e empacotamento; a extensão instalada usa o runtime do Claude Desktop
- A API REST legada habilitada no GLPI
- Token individual de usuário e, quando exigido pela instância, o token do cliente de API

## Configuração local

Copie [`glpi.example.txt`](glpi.example.txt) para um arquivo local fora deste repositório. Preencha `GLPI_URL`, `GLPI_USER_TOKEN` e `GLPI_APP_TOKEN` com os dados da sua instância. O token do cliente pode ficar vazio quando o GLPI não o exigir. `GLPI_ENABLE_WRITES` fica `false` por padrão; altere para `true` somente quando quiser habilitar ferramentas de gravação naquela instalação local.

Durante a instalação da extensão, selecione esse arquivo no campo **Arquivo de configuração do GLPI**. O caminho é salvo na configuração local da extensão; o arquivo preenchido não é copiado para o pacote. Não compartilhe nem inclua o arquivo preenchido no GitHub.

## Instalação no Claude Desktop

1. Crie seu arquivo `.txt` de configuração a partir de [`glpi.example.txt`](glpi.example.txt) e salve-o fora deste repositório.
2. Baixe `mcp-glpi-local-0.3.2.mcpb` em [Releases](https://github.com/buenolas/MCP-GLPI/releases/latest).
3. No Claude Desktop, abra **Settings → Desktop app → Manage → Advanced settings → Install Extension…** e selecione o `.mcpb` baixado.
4. Quando solicitado, selecione seu arquivo `.txt` no campo **Arquivo de configuração do GLPI**.
5. Abra uma conversa, consulte a lista de ferramentas e execute `diagnosticar_conexao`.

O pacote usa o runtime incluído no Claude Desktop, portanto colegas não precisam instalar Node.js para usar a extensão. As gravações continuam desligadas por padrão. Para habilitá-las, altere `GLPI_ENABLE_WRITES=false` para `true` no arquivo local e reinicie a extensão. O perfil e a entidade da conta GLPI selecionada continuam controlando as operações.

## Se as ferramentas não aparecerem

Confirme em **Settings → Desktop app → Manage → Extensions** que o MCP do GLPI está ativado. Se os registros mostrarem `Version negotiation failed` ou `Server disconnected`, atualize para a versão `0.3.2`, reinicie o Claude Desktop e abra uma conversa nova. Essa versão usa a entrada stdio atual do SDK MCP e negocia o protocolo antes de carregar as ferramentas. O diagnóstico de conexão com o GLPI só roda quando `diagnosticar_conexao` é chamado; a lista de ferramentas deve carregar mesmo antes dessa chamada.

## Desenvolvimento

```powershell
npm install
npm test
$env:GLPI_CONFIG_PATH = 'C:\caminho\privado\glpi.txt'
npm start
```

O servidor usa o transporte MCP `stdio`. Para gerar o pacote localmente, execute:

```powershell
npm ci
npm run package:mcpb
```

O arquivo será criado em `dist/mcp-glpi-local-0.3.2.mcpb`. O empacotador monta uma pasta temporária com uma lista explícita de arquivos de runtime e instala somente dependências de produção nessa pasta; arquivos `.txt` locais, inclusive credenciais, não são copiados. A publicação automatizada no GitHub é iniciada por uma tag `v` igual à versão em `package.json` e `manifest.json` (por exemplo, `v0.3.2`).

## Ferramentas disponíveis

- `diagnosticar_conexao` testa a sessão e informa o perfil e a entidade ativos.
- `buscar_chamados` e `buscar_projetos` pesquisam pelo nome. Aceitam `limit` entre 1 e 50 e `offset` para paginação.
- `consultar_chamado` e `consultar_projeto` consultam um registro pelo ID.
- `listar_tarefas_chamado` exige `ticket_id` e lista somente as tarefas que a conta pode consultar.
- `listar_tarefas_projeto` exige `project_id` e retorna as tarefas com prazo, estado e progresso.
- `listar_estados_projeto` retorna IDs e nomes dos estados disponíveis para usar nas gravações de projeto.
- `abrir_chamado` e `atualizar_chamado` criam ou atualizam campos selecionados de chamados.
- `criar_tarefa_chamado` e `atualizar_tarefa_chamado` gravam tarefas vinculadas ao chamado indicado por ID; são ferramentas distintas das tarefas de projeto.
- `criar_projeto` e `atualizar_projeto` criam ou atualizam projetos.
- `criar_tarefa_projeto` e `atualizar_tarefa_projeto` gravam tarefas vinculadas ao projeto indicado por ID, com estado, prazo e progresso.

As ferramentas de listagem de tarefas aceitam `limit` entre 1 e 50 e `offset` para paginação.

As ferramentas respeitam o perfil e a entidade ativos da conta GLPI. As buscas selecionam campos da API necessários para os resultados, e as consultas por ID retornam somente os campos previstos para cada recurso. Chamados e projetos incluem o link correspondente na interface do GLPI.

O servidor mantém o token de sessão em memória, tenta renová-lo uma vez após uma resposta HTTP 401 e encerra a sessão ao desligar. As respostas de erro não incluem tokens nem mensagens brutas devolvidas pela API.

As gravações usam a API legada com `session_write=true` e respeitam as permissões GLPI da conta configurada. Todos os fluxos de gravação foram implementados com allowlist de campos e respostas simuladas; não foram testados contra uma instância de homologação. Para alterar manualmente o estado de uma tarefa de projeto com `auto_projectstates=true`, envie `auto_projectstates=false`; caso contrário, o GLPI calcula o estado pelo progresso. Em caso de timeout ou resposta parcial, consulte o GLPI antes de repetir a operação para evitar duplicidade. Cada ferramenta de gravação pede confirmação explícita no fluxo do Claude.
