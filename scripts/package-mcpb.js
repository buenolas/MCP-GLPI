import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCliPath = process.env.npm_execpath;
const mcpbCli = '@anthropic-ai/mcpb@2.1.2';

function runNpm(args, cwd) {
  if (!npmCliPath) {
    throw new Error('Execute este empacotamento com npm run package:mcpb.');
  }

  const buildEnv = { ...process.env };
  for (const key of Object.keys(buildEnv)) {
    if (/^GLPI_/iu.test(key) || /^npm_config_(?:allow[_-]scripts|userconfig|globalconfig)$/iu.test(key)) {
      delete buildEnv[key];
    }
  }

  const result = spawnSync(process.execPath, [npmCliPath, ...args], {
    cwd,
    stdio: 'inherit',
    env: buildEnv,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error('Comando npm terminou com código ' + (result.status ?? 'desconhecido') + '.');
  }
}

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(projectRoot, 'manifest.json'), 'utf8'));
if (manifest.version !== packageJson.version) {
  throw new Error('A versão de manifest.json precisa corresponder à versão de package.json.');
}

const stagingRoot = await mkdtemp(join(tmpdir(), 'mcp-glpi-mcpb-'));
const stagingDirectory = join(stagingRoot, 'extension');
const npmUserConfigPath = join(stagingRoot, 'user.npmrc');
const npmGlobalConfigPath = join(stagingRoot, 'global.npmrc');
const outputDirectory = join(projectRoot, 'dist');
const outputFile = join(outputDirectory, 'mcp-glpi-local-' + manifest.version + '.mcpb');

try {
  await mkdir(stagingDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(npmUserConfigPath, 'ignore-scripts=true\nallow-scripts=\n', { flag: 'wx' });
  await writeFile(npmGlobalConfigPath, 'ignore-scripts=true\nallow-scripts=\n', { flag: 'wx' });

  for (const file of ['manifest.json', 'package.json', 'package-lock.json', '.mcpbignore']) {
    await cp(join(projectRoot, file), join(stagingDirectory, file));
  }
  await cp(join(projectRoot, 'src'), join(stagingDirectory, 'src'), { recursive: true });

  // A staging folder allowlisted above prevents local credential files from entering the bundle.
  runNpm(
    [
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--userconfig',
      npmUserConfigPath,
      '--globalconfig',
      npmGlobalConfigPath,
    ],
    stagingDirectory,
  );
  runNpm(
    [
      'exec',
      '--yes',
      '--ignore-scripts',
      '--userconfig',
      npmUserConfigPath,
      '--globalconfig',
      npmGlobalConfigPath,
      '--package',
      mcpbCli,
      '--',
      'mcpb',
      'pack',
      '.',
      outputFile,
    ],
    stagingDirectory,
  );

  const result = await stat(outputFile);
  if (!result.isFile() || result.size === 0) {
    throw new Error('O empacotador não gerou um arquivo MCPB válido.');
  }
  process.stdout.write('Extensão gerada: ' + outputFile + '\n');
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
