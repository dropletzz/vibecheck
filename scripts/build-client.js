const esbuild = require('esbuild');
const fs = require('fs').promises;
const path = require('path');

const SRC = 'src/client/public';
const OUT = 'build/public';

async function listFiles(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files;
}

(async () => {
  const files = await listFiles(SRC);
  const entryPoints = files.filter((f) => f.endsWith('.ts'));
  const staticFiles = files.filter((f) => !f.endsWith('.ts'));

  await fs.rm(OUT, { recursive: true, force: true });

  if (entryPoints.length > 0) {
    await esbuild.build({
      entryPoints,
      bundle: true,
      format: 'iife',
      outbase: SRC,
      outdir: OUT,
    });
  }

  for (const file of staticFiles) {
    const rel = path.relative(SRC, file);
    const dest = path.join(OUT, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(file, dest);
  }

  console.log(
    `vibecheck: bundled ${entryPoints.length} page(s), copied ${staticFiles.length} static file(s) into ${OUT}`
  );
})();
