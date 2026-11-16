# Guia de uso do MCP do GLPI para Project manager

Este guia reflete o teste com o **usuário 33**, perfil ativo **Project manager (10)** e entidade **IOSEI (0)**, com acesso recursivo às subentidades. A conta também tem o perfil **Technician (6)** associado. O GLPI aplica as permissões do perfil ativo e verifica o acesso ao registro. Em outra conta, compare os dados retornados pelo diagnóstico.

## Comece pela conexão

1. No Claude Desktop, confira se **MCP do GLPI** está habilitado no menu **+ → Conectores** da conversa.
2. Envie: “Use `diagnosticar_conexao` e mostre o usuário, o perfil e a entidade ativos, com nome e ID.”
3. Confira os IDs no retorno. No pacote **0.3.6**, o diagnóstico também informa `writesEnabled` e `canCreateTickets`. Para a conta testada, os valores foram **true** e **false**, respectivamente.

## Perfil Technician associado

O perfil **Technician (6)** aparece em `getMyProfiles`, mas o MCP inicia a sessão com **Project manager (10)** ativo. Testei Technician numa sessão temporária da API e restaurei Project manager e a entidade IOSEI (0) antes de encerrar. Sob Technician, a listagem de estados de projeto retornou **HTTP 403**; a leitura do projeto 85 e a listagem de tarefas desse projeto também retornaram **HTTP 403**. Nenhum registro foi alterado. Adicionar o perfil, por si só, não liberou essas leituras para a conta.

## Consultas

| Ferramenta | O que aconteceu com o perfil testado | Exemplo para pedir ao Claude |
|---|---|---|
| `diagnosticar_conexao` | Retornou os dados da sessão. | “Mostre o usuário, o perfil e a entidade da sessão do GLPI.” |
| `buscar_projetos` | Retornou projetos visíveis. A busca é pelo nome. | “Busque projetos com ‘Fernandópolis’ no nome e mostre o ID, o estado, o progresso e o link.” |
| `consultar_projeto` | Funcionou para um projeto visível. | “Consulte o projeto 15 e mostre o estado e o progresso.” |
| `listar_tarefas_projeto` | A consulta respondeu normalmente, com lista vazia nos projetos amostrados. | “Liste as tarefas visíveis do projeto 15.” |
| `listar_estados_projeto` | O GLPI recusou a leitura do catálogo com **HTTP 403** nos perfis Project manager (10) e Technician (6). A consulta de um projeto ainda pode retornar o estado associado, se a conta tiver acesso a esse projeto. | “Consulte o projeto 15 e informe o ID do estado atual.” |
| `buscar_chamados` | Retornou zero resultados no teste, inclusive sem filtro. O perfil tem visibilidade por vínculo e não tem leitura de todos os chamados. | “Liste os últimos 10 chamados visíveis, sem termo de busca.” |
| `consultar_chamado` | Depende do acesso a um chamado específico. Nenhum ID visível foi identificado no teste. | “Consulte o chamado [ID] e mostre o título e o status.” |
| `listar_tarefas_chamado` | A leitura de tarefas, inclusive privadas, depende do acesso ao chamado e à tarefa. Sem exemplo real com esta conta. | “Liste as tarefas do chamado [ID].” |

Na busca de chamados, omitir o termo lista por **data de abertura, da mais recente para a mais antiga**, a partir da versão 0.3.4. Para buscar por palavra, indique o termo que deve aparecer no **título**. As buscas por chamados e projetos aceitam até 50 resultados por página.

## Gravações

O arquivo local precisa ter `GLPI_ENABLE_WRITES=true`, e o GLPI precisa autorizar a operação. Os exemplos abaixo são fictícios. A versão 0.3.6 teve a gravação do vínculo de projeto-pai validada com a conta da Clara; as demais operações de gravação desta tabela não foram executadas nesse teste.

| Ferramenta | Permissão observada | Exemplo de pedido |
|---|---|---|
| `abrir_chamado` | **Bloqueada.** O perfil não tem a permissão **Criar** para chamados. | “Abra o chamado ‘Teste de integração’ com a descrição ‘Validar abertura pelo MCP’.” |
| `atualizar_chamado` | O perfil tem permissão de atualização, sujeita à visibilidade e às regras do chamado. | “Mostre o chamado [ID] e proponha mudar a prioridade para 3. Aguarde minha confirmação.” |
| `criar_tarefa_chamado` | O perfil pode adicionar tarefas em chamados acessíveis, conforme as regras do chamado. | “Proponha adicionar a tarefa ‘Conferir integração’ ao chamado [ID].” |
| `atualizar_tarefa_chamado` | O perfil tem permissão de atualização de tarefas, sujeita ao chamado e ao estado dele. | “Na tarefa [ID da tarefa] do chamado [ID do chamado], proponha registrar 15 minutos.” |
| `criar_projeto` | O perfil tem permissão de criação, sujeita à entidade e às regras do formulário. Aceita `parent_project_id` para criar um subprojeto. | “Busque o projeto-pai ‘Projetos Brasil’. Depois que eu confirmar o ID, prepare a criação de ‘Projeto demonstração’ como filho dele.” |
| `atualizar_projeto` | O perfil tem permissão de atualização, sujeita ao registro e à entidade. Aceita `parent_project_id`; use `0` para remover o pai. | “Mostre o projeto [ID] e proponha vinculá-lo ao projeto-pai [ID]. Aguarde minha confirmação.” |
| `criar_tarefa_projeto` | O perfil tem a permissão de atualização de projeto que o GLPI exige para criar tarefas. | “Prepare a tarefa ‘Validar entrega’ no projeto [ID].” |
| `atualizar_tarefa_projeto` | Sujeita ao acesso ao projeto, à entidade e às regras da tarefa. | “Na tarefa [ID da tarefa] do projeto [ID do projeto], proponha atualizar o progresso para 50%.” |

Antes de confirmar uma gravação, peça ao Claude para mostrar o **tipo do registro, o título, o ID exato e os campos a gravar**. Para um subprojeto, confira o ID do projeto-pai. Para uma tarefa, confira também o chamado ou o projeto de destino. Se houver nomes iguais, escolha pelo ID e pelo link. Depois da confirmação, confira o ID e o link retornados no GLPI. Para alterações de estado, use apenas um ID confirmado. Se a tarefa tiver estado automático, a mudança manual exige desativar esse modo.

A versão **0.3.6** foi testada com a conta da Clara para vincular temporariamente o projeto de teste 128 ao projeto-pai 85 e depois restaurar o vínculo original (sem pai). O GLPI confirmou as duas alterações. As demais gravações continuam sujeitas às permissões e ainda não foram validadas nessa conta.

## Quando uma operação falhar

| O que aparece | O que verificar |
|---|---|
| Zero resultados em chamados | Confira no GLPI se a mesma conta vê o chamado com o mesmo perfil e a mesma entidade. Se estiver visível, tente `consultar_chamado` pelo ID para comparar com a busca. |
| `canCreateTickets: false` | A abertura exige a permissão **Criar** em chamados no perfil aplicável. A opção local de gravação apenas habilita o envio. |
| HTTP 403 ao listar estados | Peça a um administrador para verificar se o perfil pode consultar o catálogo de estados. Para uma consulta pontual, confira o estado já associado a um projeto visível. |
| Ferramenta indisponível | Confira o conector na conversa. No log, `tools/list` indica a consulta ao catálogo e `tools/call` indica uma chamada encaminhada ao MCP. |
| HTTP 400 ao gravar | Confira o código retornado, quando disponível. A partir da versão 0.3.5 o MCP distingue os códigos reconhecidos, sem registrar os dados enviados. A recusa pode vir da permissão ou das regras do formulário. |

Fontes: [API REST do GLPI](https://help.glpi-project.org/documentation/modules/configuration/general/api/api), [chamados](https://github.com/glpi-project/glpi/blob/11.0.4/src/Ticket.php), [tarefas de chamado](https://github.com/glpi-project/glpi/blob/11.0.4/src/CommonITILTask.php), [projetos](https://github.com/glpi-project/glpi/blob/11.0.4/src/Project.php) e [tarefas de projeto](https://github.com/glpi-project/glpi/blob/11.0.4/src/ProjectTask.php).
