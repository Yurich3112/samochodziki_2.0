import { cp, mkdir, rm } from 'node:fs/promises';

const rootFiles = ['index.html', 'styles.css'];
const assetDirs = ['src', 'public'];
const outDir = 'dist';

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await Promise.all(rootFiles.map(file => cp(file, `${outDir}/${file}`)));
await Promise.all(assetDirs.map(dir => cp(dir, `${outDir}/${dir}`, { recursive: true })));
