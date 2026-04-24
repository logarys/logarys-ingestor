import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function createTestConf({ globalConfig, pipelines }) {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'logarys-ingestor-'));
  const confDir = path.join(baseDir, 'conf');
  const pipelinesDir = path.join(confDir, 'pipelines.d');

  await mkdir(pipelinesDir, { recursive: true });
  await writeFile(path.join(confDir, 'pipelines.json'), `${JSON.stringify(globalConfig, null, 2)}\n`, 'utf8');

  for (const pipeline of pipelines) {
    await writeFile(
      path.join(pipelinesDir, `${pipeline.id}.json`),
      `${JSON.stringify(pipeline, null, 2)}\n`,
      'utf8',
    );
  }

  return {
    baseDir,
    confDir,
    confFile: path.join(confDir, 'pipelines.json'),
    pipelinesDir,
    async cleanup() {
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}
