const http = require('http');
const fs = require('fs');
const path = require('path');
const connect = require('connect');
const esbuild = require('esbuild');
const { init, parse } = require('es-module-lexer');
const MagicString = require('magic-string');
const middlewares = connect();
const cacheDir = path.join(__dirname, '../', 'node_modules/.vite');
const compileSFC = require('@vue/compiler-sfc');
const compileDom = require('@vue/compiler-dom');
const optimizeDeps = async () => {
  if (fs.existsSync(cacheDir)) return false;
  fs.mkdirSync(cacheDir, { recursive: true });
  const deps = Object.keys(require('../package.json').dependencies);
  console.log(__dirname, process.cwd());
  // 将runtime的所有依赖设置为build入口
  const result = await esbuild.build({
    entryPoints: deps.map(dep => {
      const depRoot = path.resolve(__dirname, '../node_modules', dep);
      const pkgPath = path.resolve(depRoot, 'package.json');
      if (!fs.existsSync(pkgPath)) return path.resolve(__dirname, depRoot, 'index.js');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return path.resolve(depRoot, pkg.module || pkg.main);
    }),
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    splitting: true,
    sourcemap: true,
    outdir: cacheDir,
    treeShaking: 'ignore-annotations',
    metafile: true,
    define: { 'process.env.NODE_ENV': "\"development\"" }
  });

  const outputs = Object.keys(result.metafile.outputs);
  const data = {};
  deps.forEach((dep) => {
    data[dep] = '/' + outputs.find(output => output.match(new RegExp(`\/${dep}.+\.m?js$`)));
  });
  const dataPath = path.join(cacheDir, '_metadata.json');
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
};
const createServer = async () => {
  await optimizeDeps();
  http.createServer(middlewares).listen(3000, () => {
    console.log('simple-vite-dev-server start at localhost: 3000!');
  });
};
const indexHtmlMiddleware = (req, res, next) => {
  if (req.url === '/') {
    const htmlPath = path.join(__dirname, '../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.statusCode = 200;
    return res.end(htmlContent);
  }
  next();
};
const importAnalysis = async (code) => {
  await init;
  const [imports] = parse(code);
  if (!imports || !imports.length) return code;
  const metaData = require(path.join(cacheDir, '_metadata.json'));
  let transformCode = new MagicString(code);
  imports.forEach((importer) => {
    const { n, s, e } = importer;
    const replacePath = metaData[n] || n;
    transformCode = transformCode.overwrite(s, e, replacePath);
  });
  return transformCode.toString();
};
// 核心中间件: 拦截浏览器关于各种文件的请求并将其内容转换成浏览器能正确识别的代码
const transformMiddleware = async (req, res, next) => {
  if (req.url.endsWith('.js') || req.url.endsWith('.map')) {
    const jsPath = path.join(__dirname, '../', req.url);
    const code = fs.readFileSync(jsPath, 'utf-8');
    res.setHeader('Content-Type', 'application/javascript');
    res.statusCode = 200;
    const transformCode = req.url.endsWith('.map') ? code : await importAnalysis(code);
    return res.end(transformCode);
  }
  if (req.url.indexOf('.vue') !== -1) {
    const vuePath = path.join(__dirname, '../', req.url);
    const vueContent = fs.readFileSync(vuePath, 'utf-8');
    const vueParseContet = compileSFC.parse(vueContent);
    const scriptContent = vueParseContet.descriptor.script.content;
    const replaceScript = scriptContent.replace('export default ', 'const __script = ');
    const tpl = vueParseContet.descriptor.template.content;
    const tplCode = compileDom.compile(tpl, { mode: 'module' }).code;
    const tplCodeReplace = tplCode.replace('export function render(_ctx, _cache)', '__script.render=(_ctx, _cache)=>');
    const code = `
                ${await importAnalysis(replaceScript)}
                ${tplCodeReplace}
                export default __script;
        `;
    res.setHeader('Content-Type', 'application/javascript');
    res.statusCode = 200;
    return res.end(await importAnalysis(code));
  }
  next();
};
middlewares.use(indexHtmlMiddleware);
middlewares.use(transformMiddleware);
createServer();
