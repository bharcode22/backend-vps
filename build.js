const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const distDir = path.join(__dirname, 'dist');

// 1. Clean dist directory
console.log('Cleaning dist directory...');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Read dependencies to mark them as external
const pkg = require('./package.json');
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  'aws-sdk', 'mock-aws-s3', 'nock', 'node-pre-gyp'
];

console.log('Building server with esbuild...');
try {
  esbuild.buildSync({
    entryPoints: ['server.js'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/server.js',
    external: external,
    sourcemap: true,
    minify: false,
  });
  console.log('✅ Build complete: dist/server.js');
} catch (err) {
  console.error('❌ esbuild build failed:', err);
  process.exit(1);
}

// 3. Copy json-management folder
const srcJsonDir = path.join(__dirname, 'json-management');
const destJsonDir = path.join(distDir, 'json-management');
if (fs.existsSync(srcJsonDir)) {
  console.log('Copying json-management to dist...');
  fs.cpSync(srcJsonDir, destJsonDir, { recursive: true });
  console.log('✅ json-management copied successfully.');
}

// 4. Generate Prisma Client
console.log('Generating Prisma Client...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('✅ Prisma Client generated successfully.');
} catch (err) {
  console.warn('⚠️ Warning: Failed to run prisma generate. Check if DATABASE_URL or prisma schema is valid.');
}
